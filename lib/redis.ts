/**
 * Shared Upstash Redis client, spoken over its REST API.
 *
 * The deployment runs as many short-lived instances, so anything that has to be
 * shared between requests — the rate-limit counters and the frozen pre-race log —
 * cannot live in module memory. Upstash serves Redis over plain HTTPS, which means
 * no client library and no Node built-ins: the same code runs on Vercel's Node and
 * Edge runtimes and on a Cloudflare Worker.
 *
 * Configure with the variables the Vercel integration writes:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL / KV_REST_API_TOKEN          (the older names, also read)
 *
 * With neither set, callers fall back to whatever local store they had before, so
 * `next dev` still works with no account.
 */

export type RedisConfig = { url: string; token: string };

/** Redis calls are on the request path; do not let a slow store hold it open. */
const TIMEOUT_MS = 2_500;

function env(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** Null when no database is configured — callers then use their local fallback. */
export function redisConfig(): RedisConfig | null {
  const url = env("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * Run commands in one round trip. Upstash answers with one
 * `{ result }` (or `{ error }`) per command, in order. Throws on any failure so
 * the caller can decide between retrying and falling back.
 */
export async function redisCommands(
  config: RedisConfig,
  commands: (string | number)[][],
): Promise<unknown[]> {
  const res = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);

  const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(data) || data.some((entry) => entry?.error)) {
    throw new Error("upstash rejected a command");
  }
  return data.map((entry) => entry.result);
}

/** One command, unwrapped. Convenience for the common get/set case. */
export async function redisCommand(
  config: RedisConfig,
  command: (string | number)[],
): Promise<unknown> {
  const [result] = await redisCommands(config, [command]);
  return result;
}
