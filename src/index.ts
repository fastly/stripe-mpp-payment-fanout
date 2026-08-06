/// <reference types="@fastly/js-compute" />

import { env } from "fastly:env";
import { Mppx, stripe as mppStripeServer } from "mppx/server";
import { Mppx as MppxClient, stripe as mppStripeClient } from "mppx/client";
import { createStripeRestClient, createTestSharedPaymentToken } from "./stripe-rest";
import { createMppxCompatibleFetch } from "./fetch-compat";
import { CLIENT_JS, INDEX_HTML, STYLES_CSS } from "./ui";
import {
  bufferResponse,
  errorResponse,
  jsonResponse,
  makeCloneableResponse,
  readResponseBody,
  responseFromBuffer,
} from "./responses";
import {
  createStripeMeteredStream,
  handleTempoSessionRoute,
  runTempoFanoutSession,
  tempoPayerMissing,
  tempoServerMissing,
  type TempoRuntimeConfig,
} from "./streaming";
import {
  handleTempoFanoutSubscription,
  isValidFanoutSessionId,
} from "./fanout";
import { probeTempoRpc } from "./tempo-rpc";

const DEFAULT_AMOUNT = "0.50";
const DEFAULT_CURRENCY = "usd";
const DEFAULT_DESCRIPTION = "Access to a metered streaming session";
const DEFAULT_STRIPE_PROFILE_ID = "internal";
const DEFAULT_STRIPE_PAYMENT_METHOD = "pm_card_visa";
const DEFAULT_STRIPE_PAYMENT_METHOD_TYPES = ["card", "link"];
const DEFAULT_STREAM_UNITS = 10;
const DEFAULT_TEMPO_CURRENCY = "0x20c0000000000000000000000000000000000000";
const DEFAULT_TEMPO_UNIT_AMOUNT = "0.0001";
const DEFAULT_TEMPO_SUGGESTED_DEPOSIT = "0.01";
const DEFAULT_TEMPO_MAX_DEPOSIT = "0.01";

export interface RuntimeConfig extends TempoRuntimeConfig {
  stripeSecretKey: string;
  stripeProfileId: string;
  stripePaymentMethod: string;
  stripePaymentMethodTypes: string[];
  amount: string;
  currency: string;
  description: string;
  streamUnits: number;
}

function readEnv(name: string): string {
  try {
    return env(name) || "";
  } catch {
    return "";
  }
}

function readCsvEnv(name: string, fallback: string[]): string[] {
  const value = readEnv(name);
  if (!value) return fallback;

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length ? parsed : fallback;
}

function readPositiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(readEnv(name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadConfig(): RuntimeConfig {
  return {
    stripeSecretKey: readEnv("STRIPE_SECRET_KEY"),
    stripeProfileId: readEnv("STRIPE_PROFILE_ID") || DEFAULT_STRIPE_PROFILE_ID,
    stripePaymentMethod: readEnv("STRIPE_PAYMENT_METHOD") || DEFAULT_STRIPE_PAYMENT_METHOD,
    stripePaymentMethodTypes: readCsvEnv("STRIPE_PAYMENT_METHOD_TYPES", DEFAULT_STRIPE_PAYMENT_METHOD_TYPES),
    amount: readEnv("MPP_AMOUNT") || DEFAULT_AMOUNT,
    currency: readEnv("MPP_CURRENCY") || DEFAULT_CURRENCY,
    description: readEnv("MPP_DESCRIPTION") || DEFAULT_DESCRIPTION,
    streamUnits: readPositiveInteger("MPP_STREAM_UNITS", DEFAULT_STREAM_UNITS),
    mppSecretKey: readEnv("MPP_SECRET_KEY") || "local-demo-mpp-secret-change-me-32-bytes",
    tempoServerPrivateKey: readEnv("TEMPO_SERVER_PRIVATE_KEY"),
    tempoPayerPrivateKey: readEnv("TEMPO_PAYER_PRIVATE_KEY"),
    tempoRpcUrl: readEnv("TEMPO_RPC_URL"),
    tempoCurrency: (readEnv("TEMPO_CURRENCY") || DEFAULT_TEMPO_CURRENCY) as `0x${string}`,
    tempoUnitAmount: readEnv("TEMPO_UNIT_AMOUNT") || DEFAULT_TEMPO_UNIT_AMOUNT,
    tempoSuggestedDeposit:
      readEnv("TEMPO_SUGGESTED_DEPOSIT") || DEFAULT_TEMPO_SUGGESTED_DEPOSIT,
    tempoMaxDeposit: readEnv("TEMPO_MAX_DEPOSIT") || DEFAULT_TEMPO_MAX_DEPOSIT,
    fanoutServiceId: readEnv("FANOUT_SERVICE_ID"),
    fastlyApiToken: readEnv("FASTLY_API_TOKEN"),
  };
}

function validateStripeConfig(config: RuntimeConfig): string[] {
  const missing: string[] = [];
  if (!config.stripeSecretKey || config.stripeSecretKey === "sk_test_replace_me") {
    missing.push("STRIPE_SECRET_KEY");
  }
  if (!config.stripeProfileId) missing.push("STRIPE_PROFILE_ID");
  if (
    !config.mppSecretKey ||
    config.mppSecretKey === "replace-with-random-value" ||
    config.mppSecretKey.includes("change-me")
  ) {
    missing.push("MPP_SECRET_KEY");
  }
  return missing;
}

export async function handleRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const config = loadConfig();

    if (url.pathname === "/") return textResponse(INDEX_HTML, "text/html; charset=utf-8");
    if (url.pathname === "/styles.css") return textResponse(STYLES_CSS, "text/css; charset=utf-8");
    if (url.pathname === "/client.js") {
      return textResponse(CLIENT_JS, "application/javascript; charset=utf-8");
    }

    if (url.pathname === "/health") {
      const stripeMissing = validateStripeConfig(config);
      const tempoServerConfigMissing = tempoServerMissing(config);
      const tempoPayerConfigMissing = tempoPayerMissing(config);

      return jsonResponse({
        ok: true,
        demo: "fastly-mpp-fanout-streaming-demo",
        platform: "Fastly Compute",
        routes: {
          stripeCharge: "/protected-route",
          stripeStream: "/stripe-stream",
          tempoSession: "/tempo-stream",
          tempoFanoutSubscribe: "/fanout/tempo/:sessionId",
          tempoFanoutRun: "/api/stream-tempo?sessionId=:sessionId",
          tempoRpcTest: "/api/tempo-rpc-test",
        },
        stripe: {
          rail: "fiat",
          method: "stripe-spt",
          intent: "charge",
          amount: config.amount,
          currency: config.currency,
          streamUnits: config.streamUnits,
          configured: stripeMissing.length === 0,
          missing: stripeMissing,
        },
        tempo: {
          rail: "crypto",
          method: "tempo",
          intent: "session",
          unitAmount: config.tempoUnitAmount,
          suggestedDeposit: config.tempoSuggestedDeposit,
          maxDeposit: config.tempoMaxDeposit,
          serverConfigured: tempoServerConfigMissing.length === 0,
          payerConfigured: tempoPayerConfigMissing.length === 0,
          serverMissing: tempoServerConfigMissing,
          payerMissing: tempoPayerConfigMissing,
          delivery: "fastly-fanout",
          stateStore: "tempo_sessions",
          rpcBackend: "tempo_rpc",
          publishMode:
            config.fanoutServiceId && config.fastlyApiToken ? "fastly-api" : "local-pushpin",
        },
        timestamp: Date.now(),
      });
    }

    const fanoutTempoMatch = url.pathname.match(/^\/fanout\/tempo\/([^/]+)$/);
    if (fanoutTempoMatch) {
      if (request.method !== "GET") return errorResponse("Method not allowed", 405);
      const sessionId = decodeURIComponent(fanoutTempoMatch[1]);
      if (!isValidFanoutSessionId(sessionId)) {
        return errorResponse("Invalid Fanout session id", 400);
      }
      return handleTempoFanoutSubscription(request, sessionId);
    }

    if (url.pathname === "/protected-route") {
      if (request.method !== "GET") return errorResponse("Method not allowed", 405);
      return handleProtectedRoute(request, config);
    }

    if (url.pathname === "/stripe-stream") {
      if (request.method !== "GET") return errorResponse("Method not allowed", 405);
      return handleStripeStreamRoute(request, config);
    }

    if (url.pathname === "/tempo-stream") {
      if (request.method !== "GET" && request.method !== "POST") {
        return errorResponse("Method not allowed", 405);
      }
      return handleTempoSessionRoute(request, config);
    }

    if (url.pathname === "/api/fetch-protected-route") {
      if (request.method !== "POST") return errorResponse("Method not allowed", 405);
      return fetchAndPayProtectedRoute(request, config);
    }

    if (url.pathname === "/api/stream-stripe") {
      if (request.method !== "POST") return errorResponse("Method not allowed", 405);
      return fetchAndStreamStripe(request, config);
    }

    if (url.pathname === "/api/tempo-rpc-test") {
      if (request.method !== "GET") return errorResponse("Method not allowed", 405);
      if (!config.tempoRpcUrl) return errorResponse("TEMPO_RPC_URL is not configured", 500);

      try {
        const result = await probeTempoRpc(config.tempoRpcUrl);
        return jsonResponse({
          ok: true,
          backend: "tempo_rpc",
          expectedChainId: 42431,
          ...result,
        });
      } catch (error) {
        return errorResponse("Tempo RPC test failed", 502, {
          backend: "tempo_rpc",
          rpcUrl: config.tempoRpcUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (url.pathname === "/api/stream-tempo") {
      if (request.method !== "POST") return errorResponse("Method not allowed", 405);
      const sessionId = url.searchParams.get("sessionId") || "";
      if (!isValidFanoutSessionId(sessionId)) {
        return errorResponse("A valid sessionId query parameter is required", 400);
      }
      const prompt = url.searchParams.get("prompt") || "How do machine payments stream?";
      const targetUrl = new URL(`/tempo-stream?prompt=${encodeURIComponent(prompt)}`, request.url).toString();
      return runTempoFanoutSession(targetUrl, config, sessionId);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    console.error(error);
    return errorResponse(error instanceof Error ? error.message : "Unhandled error");
  }
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}

async function handleProtectedRoute(request: Request, config: RuntimeConfig): Promise<Response> {
  const missing = validateStripeConfig(config);
  if (missing.length) return errorResponse("MPP demo is not configured", 500, { missing });

  const result = await runMppCharge(request, config);
  if (result.status === 402) return result.challenge ?? errorResponse("Payment required", 402);

  const protectedResponse = jsonResponse({
    message: "Premium content accessed through MPP on Fastly Compute.",
    timestamp: Date.now(),
    note: "This endpoint uses a one-time Stripe SPT charge.",
  });

  if (!result.withReceipt) return protectedResponse;
  return attachPaymentReceipt(protectedResponse, result.withReceipt);
}

async function handleStripeStreamRoute(request: Request, config: RuntimeConfig): Promise<Response> {
  const missing = validateStripeConfig(config);
  if (missing.length) return errorResponse("Stripe stream demo is not configured", 500, { missing });

  const result = await runMppCharge(request, config);
  if (result.status === 402) return result.challenge ?? errorResponse("Payment required", 402);

  let paymentReceipt: string | null = null;
  if (result.withReceipt) {
    const receiptProbe = result.withReceipt(new Response(null, { status: 204 }));
    paymentReceipt = receiptProbe.headers.get("Payment-Receipt");
  }

  return createStripeMeteredStream(
    {
      amount: config.amount,
      currency: config.currency,
      units: config.streamUnits,
    },
    paymentReceipt,
  );
}

function createMppx(config: RuntimeConfig, request: Request): unknown {
  const stripeMethod = mppStripeServer.charge({
    client: createStripeRestClient(config) as never,
    networkId: config.stripeProfileId,
    paymentMethodTypes: config.stripePaymentMethodTypes,
  });

  return Mppx.create({
    methods: [stripeMethod],
    realm: new URL(request.url).host,
    secretKey: config.mppSecretKey,
  });
}

async function runMppCharge(request: Request, config: RuntimeConfig): Promise<any> {
  const mppx = createMppx(config, request) as any;

  if (mppx.stripe?.charge) {
    return mppx.stripe.charge({
      amount: config.amount,
      currency: config.currency,
      decimals: 2,
      description: config.description,
    })(request);
  }

  return mppx.charge({ amount: config.amount, description: config.description })(request);
}

async function attachPaymentReceipt(
  response: Response,
  withReceipt: (response: Response) => Response,
): Promise<Response> {
  const preserved = await bufferResponse(response);
  const responseForReceipt = await makeCloneableResponse(responseFromBuffer(preserved));
  const receiptResponse = withReceipt(responseForReceipt);
  return responseFromBuffer(preserved, receiptResponse.headers);
}

function createStripePayer(config: RuntimeConfig): any {
  const stripeMethod = mppStripeClient.charge({
    client: {} as never,
    createToken: async ({ amount, currency, expiresAt, metadata, networkId, paymentMethod }: any) => {
      return createTestSharedPaymentToken(config, {
        paymentMethod: paymentMethod || config.stripePaymentMethod,
        amount,
        currency,
        expiresAt,
        networkId,
        metadata,
      });
    },
  });

  return MppxClient.create({
    methods: [stripeMethod],
    polyfill: false,
    fetch: createMppxCompatibleFetch(),
    onChallenge: async (challenge: any, { createCredential }: any) => {
      const methodDetails = challenge.request?.methodDetails as
        | { paymentMethodTypes?: string[] }
        | undefined;
      const paymentMethodTypes = methodDetails?.paymentMethodTypes || config.stripePaymentMethodTypes;

      return createCredential({
        paymentMethod: config.stripePaymentMethod,
        paymentMethodTypes,
      });
    },
  } as never);
}

async function fetchAndStreamStripe(request: Request, config: RuntimeConfig): Promise<Response> {
  const missing = validateStripeConfig(config);
  if (missing.length) return errorResponse("Stripe stream demo is not configured", 500, { missing });

  try {
    const targetUrl = new URL("/stripe-stream", request.url).toString();
    const mppx = createStripePayer(config);
    const paidResponse = await mppx.fetch(targetUrl, {
      headers: { Accept: "text/event-stream" },
    });

    const headers = new Headers(paidResponse.headers);
    headers.set("Cache-Control", "no-store, no-transform");
    headers.set("X-MPP-Demo-Helper", "server-side-stripe-payer");

    return new Response(paidResponse.body, {
      status: paidResponse.status,
      statusText: paidResponse.statusText,
      headers,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        paid: false,
        method: "stripe-spt",
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

async function fetchAndPayProtectedRoute(request: Request, config: RuntimeConfig): Promise<Response> {
  const missing = validateStripeConfig(config);
  const targetUrl = new URL("/protected-route", request.url).toString();

  if (missing.length) return errorResponse("MPP demo is not configured", 500, { missing });

  try {
    const mppx = createStripePayer(config);
    const paidResponse = await mppx.fetch(targetUrl, { headers: { Accept: "application/json" } });
    const paymentReceipt = paidResponse.headers.get("Payment-Receipt");
    const body = await readResponseBody(paidResponse);

    return jsonResponse(
      {
        ok: paidResponse.ok,
        paid: paidResponse.ok && Boolean(paymentReceipt),
        method: "stripe-spt",
        status: paidResponse.status,
        statusText: paidResponse.statusText,
        targetUrl,
        stripe: {
          profileId: config.stripeProfileId,
          amount: config.amount,
          currency: config.currency,
          paymentMethod: config.stripePaymentMethod,
          paymentMethodTypes: config.stripePaymentMethodTypes,
        },
        paymentReceipt: paymentReceipt ? "present" : "missing",
        result: body,
      },
      paidResponse.status || 500,
      paymentReceipt ? { "Payment-Receipt": paymentReceipt } : undefined,
    );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        paid: false,
        method: "stripe-spt",
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
