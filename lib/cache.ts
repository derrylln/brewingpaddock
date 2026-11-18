import { unstable_cache } from "next/cache";

/**
 * Caching for upstream data.
 *
 * Layer 1 is the isolate's memory: free, instantaneous, gone when the isolate is
 * recycled.
 *
 * Layer 2 is Next's data cache (`unstable_cache`), which on this deployment is
 * backed by the platform's R2 incremental cache — so it survives isolate churn
 * and is shared between every visitor in every colo. The Workers Cache API is
 * *not* used: the platform refuses `caches.default` access ("This Worker is not
 * permitted to access the default cache"), which is why an in-memory-only cache
 * was not enough.
 *
 * `cached()` also keeps a last-known-good copy per isolate and serves it when the
 * producer throws, so a throttled upstream degrades to slightly older data
 * rather than an error.
 */

type Entry<T> = { at: number; value: T };

const memory = new Map<string, Entry<unknown>>();
const MEMORY_LIMIT = 400;
/** How stale a copy we will still serve when the producer fails: 24 hours. */
const STALE_MAX_MS = 24 * 60 * 60 * 1000;

function trim(): void {
  if (memory.size <= MEMORY_LIMIT) return;
  const oldest = [...memory.entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, memory.size - MEMORY_LIMIT);
  for (const [key] of oldest) memory.delete(key);
}

export function memoryGet<T>(key: string): T | null {
  const entry = memory.get(key) as Entry<T> | undefined;
  return entry ? entry.value : null;
}

export function memorySet<T>(key: string, value: T): void {
  memory.set(key, { at: Date.now(), value });
  trim();
}

export async function cached<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const mem = memory.get(key) as Entry<T> | undefined;
  if (mem && now - mem.at < ttlMs) return mem.value;

  // `unstable_cache` needs whole seconds; below a second is not worth a cache.
  const revalidate = Math.max(1, Math.round(ttlMs / 1000));
  const run = unstable_cache(producer, ["brewing-paddock", key], { revalidate });

  try {
    const value = await run();
    memory.set(key, { at: Date.now(), value });
    trim();
    return value;
  } catch (error) {
    if (mem && Date.now() - mem.at < STALE_MAX_MS) return mem.value;
    throw error;
  }
}

/** Drop a key from the isolate cache (the data cache expires on its own revalidate). */
export function forget(key: string): void {
  memory.delete(key);
}
