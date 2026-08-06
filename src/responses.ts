export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: responseHeaders,
  });
}

export function errorResponse(message: string, status = 500, details?: unknown): Response {
  return jsonResponse(
    {
      ok: false,
      error: message,
      ...(details === undefined ? {} : { details }),
    },
    status,
  );
}

export interface BufferedResponse {
  body: ArrayBuffer | null;
  status: number;
  statusText: string;
  headers: Headers;
}

export async function bufferResponse(response: Response): Promise<BufferedResponse> {
  const body = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  return {
    body,
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  };
}

export function responseFromBuffer(buffered: BufferedResponse, overrideHeaders?: HeadersInit): Response {
  const headers = new Headers(buffered.headers);
  if (overrideHeaders) {
    new Headers(overrideHeaders).forEach((value, key) => headers.set(key, value));
  }

  return new Response(buffered.body ? buffered.body.slice(0) : null, {
    status: buffered.status,
    statusText: buffered.statusText,
    headers,
  });
}

export async function makeCloneableResponse(response: Response): Promise<Response> {
  const buffered = await bufferResponse(response);
  const makeResponse = () => responseFromBuffer(buffered);
  const cloneable = makeResponse();

  Object.defineProperty(cloneable, "clone", {
    value: makeResponse,
    writable: true,
    configurable: true,
  });

  return cloneable;
}

export async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return "";
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
