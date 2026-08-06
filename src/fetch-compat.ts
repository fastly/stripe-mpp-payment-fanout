/**
 * Fastly Compute's Response implementation does not currently expose clone().
 * mppx uses clone() only to create immutable event snapshots while processing
 * payment challenges and successful payment responses.
 *
 * Returning a metadata-only clone avoids consuming or buffering a live SSE body.
 */
export function makeMppxCompatibleResponse(response: Response): Response {
  const cloneable = response as Response & { clone?: () => Response };
  if (typeof cloneable.clone === "function") {
    return response;
  }

  Object.defineProperty(cloneable, "clone", {
    value: () => responseMetadataSnapshot(response),
    writable: true,
    configurable: true,
  });

  return cloneable;
}

export function createMppxCompatibleFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (...args) => makeMppxCompatibleResponse(await baseFetch(...args));
}

function responseMetadataSnapshot(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}
