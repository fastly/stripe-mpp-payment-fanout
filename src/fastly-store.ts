import { KVStore } from "fastly:kv-store";
import type { Store as MppStore } from "mppx/server";
import { Json } from "ox";

const DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * Adapts a Fastly KV Store to the mppx AtomicStore interface.
 *
 * The update method is a sequential read-modify-write adapter intended for
 * this single-payer demo. Fastly KV does not expose the current generation
 * marker through the JavaScript entry API, so this is not a cross-instance
 * compare-and-set implementation.
 */
export function createFastlyKvSessionStore(
  storeName = "tempo_sessions",
  keyPrefix = "mppx/tempo/",
): MppStore.AtomicStore {
  const keyLocks = new Map<string, Promise<void>>();

  const store = (): KVStore => new KVStore(storeName);
  const keyFor = (key: string): string => `${keyPrefix}${key}`;

  async function read(key: string): Promise<unknown | null> {
    const entry = await store().get(keyFor(key));
    if (!entry) return null;
    return Json.parse(await entry.text());
  }

  async function write(key: string, value: unknown): Promise<void> {
    await store().put(keyFor(key), Json.stringify(value), {
      ttl: DEFAULT_TTL_SECONDS,
    });
  }

  return {
    async get(key: string) {
      return read(key);
    },

    async put(key: string, value: unknown) {
      await write(key, value);
    },

    async delete(key: string) {
      await store().delete(keyFor(key));
    },

    async update<result>(
      key: string,
      fn: (current: unknown | null) => MppStore.Change<unknown, result>,
    ): Promise<result> {
      while (keyLocks.has(key)) await keyLocks.get(key);

      let release!: () => void;
      keyLocks.set(
        key,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      try {
        const current = await read(key);
        const change = fn(current);

        if (change.op === "set") await write(key, change.value);
        if (change.op === "delete") await store().delete(keyFor(key));

        return change.result;
      } finally {
        keyLocks.delete(key);
        release();
      }
    },
  } as MppStore.AtomicStore;
}
