import { createClient, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readContract } from "viem/actions";
import { Chain } from "viem/tempo";
import { Mppx, tempo as tempoServer } from "mppx/server";
import { tempo as tempoClient } from "mppx/client";
import { createMppxCompatibleFetch } from "./fetch-compat";
import { createFastlyKvSessionStore } from "./fastly-store";
import { createTempoRpcTransport } from "./tempo-rpc";
import {
  closeTempoChannel,
  publishTempoEvent,
  type FanoutRuntimeConfig,
} from "./fanout";

export interface TempoRuntimeConfig extends FanoutRuntimeConfig {
  mppSecretKey: string;
  tempoServerPrivateKey: string;
  tempoPayerPrivateKey: string;
  tempoRpcUrl: string;
  tempoCurrency: Hex;
  tempoUnitAmount: string;
  tempoSuggestedDeposit: string;
  tempoMaxDeposit: string;
}

export interface StripeStreamConfig {
  amount: string;
  currency: string;
  units: number;
}

const encoder = new TextEncoder();
const tempoStore = createFastlyKvSessionStore("tempo_sessions");
let tempoServerCache:
  | {
      fingerprint: string;
      mppx: any;
    }
  | undefined;

export function tempoServerMissing(config: TempoRuntimeConfig): string[] {
  const missing: string[] = [];
  if (
    !config.mppSecretKey ||
    config.mppSecretKey === "replace-with-random-value" ||
    config.mppSecretKey.includes("change-me")
  ) {
    missing.push("MPP_SECRET_KEY");
  }
  if (!isPrivateKey(config.tempoServerPrivateKey)) missing.push("TEMPO_SERVER_PRIVATE_KEY");
  if (!config.tempoRpcUrl) missing.push("TEMPO_RPC_URL");
  return missing;
}

export function tempoPayerMissing(config: TempoRuntimeConfig): string[] {
  const missing = tempoServerMissing(config);
  if (!isPrivateKey(config.tempoPayerPrivateKey)) missing.push("TEMPO_PAYER_PRIVATE_KEY");
  return missing;
}

export async function handleTempoSessionRoute(
  request: Request,
  config: TempoRuntimeConfig,
): Promise<Response> {
  const missing = tempoServerMissing(config);
  if (missing.length) {
    return jsonError("Tempo session demo is not configured", 500, { missing });
  }

  const mppx = createTempoServer(config);
  const result = await mppx.session({
    amount: config.tempoUnitAmount,
    suggestedDeposit: config.tempoSuggestedDeposit,
    unitType: "token",
  })(request);

  if (result.status === 402) {
    return result.challenge;
  }

  if (request.method !== "GET") {
    return result.withReceipt(new Response(null, { status: 204 }));
  }

  const url = new URL(request.url);
  const prompt = url.searchParams.get("prompt") || "How do machine payments stream?";
  const unit = readPositiveUnit(url.searchParams.get("unit"));
  const token = tempoTokenForUnit(prompt, unit);

  return result.withReceipt(
    new Response(
      JSON.stringify({
        ok: true,
        rail: "tempo",
        intent: "session",
        unit,
        token,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    ),
  );
}

export function createStripeMeteredStream(
  config: StripeStreamConfig,
  paymentReceipt?: string | null,
): Response {
  const units = Math.max(1, Math.min(config.units, 100));
  const unitAmount = divideDecimal(config.amount, units);
  const sessionId = `spt_${randomId()}`;
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      sendEvent(controller, "session", {
        type: "session-started",
        sessionId,
        rail: "stripe-spt",
        intent: "charge",
        settlement: "preauthorized-budget",
        authorizedAmount: config.amount,
        currency: config.currency,
        unitAmount,
        units,
        paymentReceipt: paymentReceipt ? "present" : "missing",
      });

      const fragments = streamFragments();

      for (let index = 0; index < units && !cancelled; index++) {
        await delay(240);
        const cumulative = index + 1;

        sendEvent(controller, "chunk", {
          type: "chunk",
          sessionId,
          rail: "stripe-spt",
          unit: cumulative,
          units,
          unitAmount,
          cumulativeAmount: multiplyDecimal(unitAmount, cumulative),
          currency: config.currency,
          token: fragments[index % fragments.length],
        });
      }

      if (!cancelled) {
        sendEvent(controller, "receipt", {
          type: "session-complete",
          sessionId,
          rail: "stripe-spt",
          intent: "charge",
          chargedAmount: config.amount,
          meteredAmount: multiplyDecimal(unitAmount, units),
          currency: config.currency,
          units,
          note: "Stripe SPT authorizes one MPP charge before the stream. Per-unit metering is application-level in this demo.",
        });
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-MPP-Demo-Rail": "stripe-spt",
    "X-MPP-Demo-Intent": "charge",
  });

  if (paymentReceipt) headers.set("Payment-Receipt", paymentReceipt);

  return new Response(body, { status: 200, headers });
}

/**
 * Runs the native Tempo payer and publishes each paid unit to Fanout.
 *
 * The browser connection is held by Fanout/Pushpin. This request only drives
 * the MPP session and publishes protocol events to the subscribed channel.
 */
export async function runTempoFanoutSession(
  targetUrl: string,
  config: TempoRuntimeConfig,
  sessionId: string,
): Promise<Response> {
  const missing = tempoPayerMissing(config);
  if (missing.length) {
    return jsonError("Tempo session payer is not configured", 500, { missing });
  }

  const payer = privateKeyToAccount(config.tempoPayerPrivateKey as Hex);
  const client = createClient({
    account: payer,
    chain: Chain.testnet,
    pollingInterval: 1_000,
    transport: createTempoRpcTransport(config.tempoRpcUrl),
  });

  let sequence = 0;
  let previousId: string | undefined;
  const publish = async (event: string, data: unknown, close = false): Promise<void> => {
    const id = `${sessionId}:${++sequence}`;
    await publishTempoEvent(config, sessionId, event, data, {
      id,
      previousId,
      close,
    });
    previousId = id;
  };

  let protocolRequest = 0;
  const protocolFetch: typeof fetch = async (input, init) => {
    const requestNumber = ++protocolRequest;
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    await publish("protocol", {
      type: "protocol-request",
      rail: "tempo",
      sessionId,
      requestNumber,
      method: request.method,
      path: `${url.pathname}${url.search}`,
    });

    const response = await withTimeout(
      fetch(input, { ...init, backend: "self" } as RequestInit),
      20_000,
      `Tempo protocol request ${requestNumber} timed out`,
    );

    await publish("protocol", {
      type: "protocol-response",
      rail: "tempo",
      sessionId,
      requestNumber,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      status: response.status,
      challenge: response.status === 402,
    });

    return response;
  };

  const session = tempoClient.session.manager({
    account: payer,
    client,
    fetch: createMppxCompatibleFetch(protocolFetch),
    maxDeposit: config.tempoMaxDeposit,
  });

  try {
    await publish("session", {
      type: "opening-channel",
      rail: "tempo",
      intent: "session",
      sessionId,
      delivery: "fastly-fanout",
      stateStore: "fastly-kv",
      payer: payer.address,
      maxDeposit: config.tempoMaxDeposit,
      suggestedDeposit: config.tempoSuggestedDeposit,
      unitAmount: config.tempoUnitAmount,
      currency: config.tempoCurrency,
    });

    const rpcChainId = await withTimeout(
      client.request({ method: "eth_chainId" }),
      10_000,
      "Tempo RPC chain-id request timed out",
    );

    await publish("session", {
      type: "rpc-ready",
      rail: "tempo",
      sessionId,
      rpcUrl: config.tempoRpcUrl,
      chainId: String(rpcChainId),
    });

    const server = privateKeyToAccount(config.tempoServerPrivateKey as Hex);
    const [payerBalance, serverBalance] = await withTimeout(
      Promise.all([
        readTip20Balance(client, config.tempoCurrency, payer.address),
        readTip20Balance(client, config.tempoCurrency, server.address),
      ]),
      10_000,
      "Tempo wallet balance check timed out",
    );
    const requiredDeposit = parseUnits(config.tempoMaxDeposit, 6);

    await publish("session", {
      type: "wallets-ready",
      rail: "tempo",
      sessionId,
      payer: payer.address,
      payerBalance: formatRawAmount(payerBalance),
      server: server.address,
      serverBalance: formatRawAmount(serverBalance),
      requiredDeposit: config.tempoMaxDeposit,
      currency: "pathUSD",
    });

    if (payerBalance < requiredDeposit) {
      throw new Error(
        `Tempo payer balance ${formatRawAmount(payerBalance)} pathUSD is below the required ${config.tempoMaxDeposit} pathUSD deposit`,
      );
    }
    if (serverBalance === 0n) {
      throw new Error("Tempo server wallet has no pathUSD for channel settlement fees");
    }

    const fragments = tempoFragments(new URL(targetUrl).searchParams.get("prompt") || "");
    let units = 0;

    for (let index = 0; index < fragments.length; index++) {
      const unit = index + 1;
      const unitUrl = new URL(targetUrl);
      unitUrl.searchParams.set("unit", String(unit));

      await publish("session", {
        type: "authorizing-unit",
        rail: "tempo",
        sessionId,
        unit,
      });

      const paidResponse = await withTimeout(
        session.fetch(unitUrl, {
          headers: {
            Accept: "application/json",
          },
        }),
        45_000,
        `Tempo unit ${unit} payment timed out`,
      );

      const responseText = await paidResponse.text();
      let payload: { token?: unknown; unit?: unknown } = {};
      if (responseText) {
        try {
          payload = JSON.parse(responseText) as { token?: unknown; unit?: unknown };
        } catch {
          throw new Error(`Tempo unit ${unit} returned invalid JSON: ${responseText.slice(0, 160)}`);
        }
      }

      if (!paidResponse.ok) {
        throw new Error(
          `Tempo unit ${unit} failed with ${paidResponse.status}${responseText ? `: ${responseText}` : ""}`,
        );
      }

      const token = typeof payload.token === "string" ? payload.token : fragments[index];
      units = unit;

      if (unit === 1) {
        await publish("session", {
          type: "channel-opened",
          rail: "tempo",
          intent: "session",
          sessionId,
          delivery: "fastly-fanout",
          channelId: session.channelId || null,
          note: "Fanout is the only long-lived stream. Tempo usage is metered with finite session requests.",
        });
      }

      await publish("chunk", {
        type: "chunk",
        rail: "tempo",
        intent: "session",
        sessionId,
        delivery: "fastly-fanout",
        token,
        unit,
        unitAmount: config.tempoUnitAmount,
        cumulativeAmount: formatRawAmount(session.cumulative),
        currency: "pathUSD",
      });
    }

    await publish("session", {
      type: "closing-channel",
      rail: "tempo",
      sessionId,
      channelId: session.channelId || null,
      cumulativeAmount: formatRawAmount(session.cumulative),
    });

    const receipt = await withTimeout(
      session.close(),
      45_000,
      "Tempo channel close timed out",
    );
    const settled = {
      type: "session-settled",
      rail: "tempo",
      intent: "session",
      sessionId,
      delivery: "fastly-fanout",
      channelId: receipt?.channelId || null,
      acceptedCumulative: receipt?.acceptedCumulative || String(session.cumulative),
      units: receipt?.units || units,
      txHash: receipt?.txHash || null,
    };

    await publish("receipt", settled, true);

    return jsonOk({
      ok: true,
      paid: true,
      method: "tempo-session",
      ...settled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      await publish("error", {
        type: "error",
        rail: "tempo",
        intent: "session",
        sessionId,
        message,
      });
      await closeTempoChannel(config, sessionId);
    } catch (publishError) {
      console.error("Unable to publish Tempo error to Fanout", publishError);
    }

    return jsonError("Tempo Fanout session failed", 500, {
      sessionId,
      message,
    });
  }
}

function createTempoServer(config: TempoRuntimeConfig): any {
  const fingerprint = [
    config.mppSecretKey,
    config.tempoServerPrivateKey,
    config.tempoRpcUrl,
    config.tempoCurrency,
  ].join("|");

  if (tempoServerCache?.fingerprint === fingerprint) return tempoServerCache.mppx;

  const account = privateKeyToAccount(config.tempoServerPrivateKey as Hex);
  const client = createClient({
    account,
    chain: Chain.testnet,
    pollingInterval: 1_000,
    transport: createTempoRpcTransport(config.tempoRpcUrl),
  });

  const mppx = Mppx.create({
    secretKey: config.mppSecretKey,
    methods: [
      tempoServer.session({
        account,
        currency: config.tempoCurrency,
        getClient: () => client,
        store: tempoStore,
      }),
    ],
  });

  tempoServerCache = { fingerprint, mppx };
  return mppx;
}

function tempoFragments(prompt: string): string[] {
  return [
    "MPP opens one payment channel ",
    "for the session. ",
    "The payer increases its cumulative authorization ",
    "as usage advances. ",
    "Each successful unit request ",
    "is verified at Fastly Compute ",
    "and published through Fanout. ",
    "Pushpin holds the browser connection locally. ",
    "No internal SSE request remains open. ",
    `\n\nPrompt: ${prompt || "How do machine payments stream?"}`,
  ];
}

function tempoTokenForUnit(prompt: string, unit: number): string {
  const fragments = tempoFragments(prompt);
  const index = Math.max(0, Math.min(unit - 1, fragments.length - 1));
  return fragments[index];
}

function readPositiveUnit(value: string | null): number {
  const parsed = Number.parseInt(value || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function streamFragments(): string[] {
  return [
    "Streaming ",
    "content ",
    "arrives ",
    "one ",
    "metered ",
    "unit ",
    "at ",
    "a ",
    "time. ",
    "The session stays open while the service is consumed. ",
  ];
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(message: string, status: number, details?: unknown): Response {
  return new Response(
    JSON.stringify({ ok: false, error: message, ...(details === undefined ? {} : { details }) }, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

const TIP20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

async function readTip20Balance(
  client: ReturnType<typeof createClient>,
  token: Hex,
  account: Hex,
): Promise<bigint> {
  return readContract(client, {
    address: token,
    abi: TIP20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

async function withTimeout<value>(
  promise: Promise<value>,
  timeoutMs: number,
  message: string,
): Promise<value> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPrivateKey(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function randomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatRawAmount(value: bigint): string {
  const raw = value.toString().padStart(7, "0");
  return `${raw.slice(0, -6)}.${raw.slice(-6)}`.replace(/\.?0+$/, "") || "0";
}

function divideDecimal(value: string, divisor: number): string {
  const scale = 1_000_000;
  const raw = Math.round(Number(value) * scale);
  return (raw / divisor / scale).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function multiplyDecimal(value: string, multiplier: number): string {
  return (Number(value) * multiplier).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
