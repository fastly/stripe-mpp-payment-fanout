import { custom, type CustomTransport } from "viem";

const TEMPO_RPC_BACKEND = "tempo_rpc";
let nextRpcId = 1;

type FastlyRequestInit = RequestInit & {
  backend?: string;
};

interface JsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

/**
 * Route Tempo JSON-RPC traffic through the named Fastly backend.
 *
 * Do not pass AbortSignal into Fastly fetch. viem's normal HTTP transport
 * creates an AbortController-backed signal for each request, while the
 * Fastly JavaScript runtime does not currently implement that integration.
 */
export const tempoRpcFetch: typeof fetch = async (input, init) => {
  const { signal: _unsupportedSignal, ...safeInit } = init || {};

  return fetch(input, {
    ...safeInit,
    backend: TEMPO_RPC_BACKEND,
  } as FastlyRequestInit);
};

async function tempoRpcRequest(
  rpcUrl: string,
  method: string,
  params: readonly unknown[] | object | undefined,
): Promise<unknown> {
  const response = await tempoRpcFetch(rpcUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextRpcId++,
      method,
      params: params ?? [],
    }),
  });

  const text = await response.text();
  let payload: JsonRpcResponse;

  try {
    payload = text ? (JSON.parse(text) as JsonRpcResponse) : {};
  } catch {
    throw new Error(
      `Tempo RPC returned invalid JSON for ${method} (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Tempo RPC returned HTTP ${response.status} for ${method}: ${text.slice(0, 200)}`,
    );
  }

  if (payload.error) {
    const error = new Error(
      `Tempo RPC error ${payload.error.code ?? "unknown"} for ${method}: ${payload.error.message || "Unknown RPC error"}`,
    ) as Error & { code?: number; data?: unknown };
    error.code = payload.error.code;
    error.data = payload.error.data;
    throw error;
  }

  if (!("result" in payload)) {
    throw new Error(`Tempo RPC response for ${method} did not include a result`);
  }

  return payload.result;
}

/**
 * viem-compatible transport that avoids viem's AbortController-based HTTP
 * transport. All standard and Tempo JSON-RPC methods go through one finite
 * Fastly backend request.
 */
export function createTempoRpcTransport(rpcUrl: string): CustomTransport {
  return custom(
    {
      request: ({ method, params }: { method: string; params?: readonly unknown[] | object }) =>
        tempoRpcRequest(rpcUrl, method, params),
    },
    {
      key: "tempo-fastly-rpc",
      name: "Tempo RPC through Fastly backend",
      retryCount: 0,
    },
  );
}

export async function probeTempoRpc(rpcUrl: string): Promise<{
  rpcUrl: string;
  chainIdHex: string;
  chainId: number;
}> {
  const result = await tempoRpcRequest(rpcUrl, "eth_chainId", []);

  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
    throw new Error(`Tempo RPC returned an invalid chain id: ${String(result)}`);
  }

  return {
    rpcUrl,
    chainIdHex: result,
    chainId: Number.parseInt(result.slice(2), 16),
  };
}
