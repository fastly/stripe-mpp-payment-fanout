export interface TrackedResponse {
  response: Response;
  done: Promise<void>;
}

/**
 * Keep a generated SSE response tied to the FetchEvent lifetime.
 *
 * Fastly can send the Response headers before an application-created
 * ReadableStream has finished producing data. The caller must pass `done`
 * to FetchEvent.waitUntil() so the sandbox is not terminated mid-stream.
 */
export function trackStreamingResponse(response: Response): TrackedResponse {
  const contentType = response.headers.get("Content-Type") || "";
  if (!response.body || !contentType.toLowerCase().includes("text/event-stream")) {
    return { response, done: Promise.resolve() };
  }

  const reader = response.body.getReader();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    resolveDone();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });

  return {
    response: new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    }),
    done,
  };
}
