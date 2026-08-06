/// <reference types="@fastly/js-compute" />

import { allowDynamicBackends } from "fastly:experimental";
import { handleRequest } from "./index";
import { trackStreamingResponse } from "./stream-lifetime";

allowDynamicBackends(true);

addEventListener("fetch", (event: FetchEvent) => {
  let finishLifetime!: () => void;
  const lifetime = new Promise<void>((resolve) => {
    finishLifetime = resolve;
  });

  // Fastly requires the first waitUntil() call to happen synchronously in
  // the fetch callback. The promise resolves when the SSE body completes or
  // the downstream client cancels it.
  event.waitUntil(lifetime);

  event.respondWith(
    (async () => {
      try {
        const handled = await handleRequest(event.request);
        const tracked = trackStreamingResponse(handled);
        void tracked.done.then(finishLifetime, finishLifetime);
        return tracked.response;
      } catch (error) {
        finishLifetime();
        throw error;
      }
    })(),
  );
});
