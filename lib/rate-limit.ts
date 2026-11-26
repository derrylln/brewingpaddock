import { NextResponse } from "next/server";

/**
 * Light per-visitor throttle.
 *
 * This is a fairness valve, not security: one person clicking through sessions in
 * a loop must not spend the OpenF1 allowance the whole site shares.
 *
 * Identity is a `bp-vid` cookie issued on the first call, so every tab of one
 * browser shares a bucket. The platform does not forward the client IP, so IP is
 * only a fallback for cookie-less traffic — and if neither exists the throttle
 * steps aside rather than lumping every visitor into one bucket.
 *
 * Counters must live outside the instance: requests land on fresh instances, so
 * an in-memory bucket never accumulates and a "limit" that never fires is worse
 * than none. On Vercel the store is Upstash Redis over its REST API
 * (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`; the Vercel integration's
 * `KV_REST_API_URL` + `KV_REST_API_TOKEN` are accepted too), counted with a
 * fixed window of INCR against a key that carries its own TTL.
 *
 * On Cloudflare Workers the older R2 binding (`NEXT_INC_CACHE_R2_BUCKET`) is
 * still used when present, so a self-hosted Workers deploy keeps working. With
 * neither configured (plain `next dev`) the counters fall back to memory.
 */

type Bucket = { hits: number[] };
type R2Like = {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(key: string, value: string): Promise<unknown>;
};
type Store = { kind: "redis"; url: string; token: string } | { kind: "r2"; bucket: R2Like };

const memory = new Map<string, Bucket>();
const COOKIE = "bp-vid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const KEY_PREFIX = "bp-ratelimit";
/** Redis calls are on the request path; do not let a slow store hold it open. */
const REDIS_TIMEOUT_MS = 2_500;
let lastSweep = Date.now();
let resolvedStore: Store | null | undefined;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of memory) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > 10 * 60_000) {
      memory.delete(key);
    }
  }
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

async function store(): Promise<Store | null> {
  if (resolvedStore !== undefined) return resolvedStore;

  const url = env("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");
  if (url && token) {
    resolvedStore = { kind: "redis", url: url.replace(/\/+$/, ""), token };
    return resolvedStore;
  }

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const bindings = (ctx?.env ?? {}) as Record<string, unknown>;
    const candidate = bindings.NEXT_INC_CACHE_R2_BUCKET as R2Like | undefined;
    if (candidate && typeof candidate.get === "function") {
      resolvedStore = { kind: "r2", bucket: candidate };
      return resolvedStore;
    }
  } catch {
    // Not running on Workers: no binding to find.
  }

  resolvedStore = null;
  return resolvedStore;
}

/**
 * One REST round trip: create the window if it is missing, count the hit, read
 * the clock left. `SET … NX` sets the TTL once, so the window is fixed rather
 * than sliding — a visitor hammering the endpoint still gets a fresh allowance
 * when the window ends instead of being locked out forever.
 */
async function redisCount(store: { url: string; token: string }, key: string, windowMs: number) {
  const res = await fetch(`${store.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${store.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["SET", key, 0, "PX", windowMs, "NX"],
      ["INCR", key],
      ["PTTL", key],
    ]),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(data) || data.some((entry) => entry?.error)) {
    throw new Error("upstash pipeline rejected the counters");
  }
  const count = Number(data[1]?.result);
  const ttl = Number(data[2]?.result);
  if (!Number.isFinite(count) || count < 1) throw new Error("upstash returned no counter");
  return { count, ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : windowMs };
}

export function clientKey(request: Request): string | null {
  const headers = request.headers;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

function visitorCookie(request: Request): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9-]{8,64})`));
  return match ? match[1] : null;
}

export type LimitResult = { ok: true; remaining: number } | { ok: false; retryAfter: number };

function decide(hits: number[], limit: number, windowMs: number, now: number): LimitResult {
  const recent = hits.filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  return { ok: true, remaining: limit - recent.length - 1 };
}

/** Last resort and `next dev`: per-instance buckets, swept so they cannot grow. */
function memoryLimit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = memory.get(key) ?? { hits: [] };
  const verdict = decide(bucket.hits, limit, windowMs, now);
  if (!verdict.ok) {
    memory.set(key, { hits: bucket.hits.filter((at) => now - at < windowMs) });
    return verdict;
  }
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);
  bucket.hits.push(now);
  memory.set(key, bucket);
  return verdict;
}

async function r2Limit(bucketStore: R2Like, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const objectKey = `${KEY_PREFIX}/${key.replace(":", "/")}.json`;
  let hits: number[] = [];
  try {
    const existing = await bucketStore.get(objectKey);
    if (existing) {
      const data = (await existing.json()) as { hits?: unknown };
      if (Array.isArray(data?.hits)) {
        hits = data.hits.filter((at): at is number => typeof at === "number" && now - at < windowMs);
      }
    }
  } catch {
    // A broken read must not block the request; fall through with an empty slate.
  }

  const verdict = decide(hits, limit, windowMs, now);
  if (!verdict.ok) return verdict;

  try {
    await bucketStore.put(objectKey, JSON.stringify({ hits: [...hits, now] }));
  } catch {
    // Same for writes: the request is allowed, the counter is just best-effort.
  }
  return verdict;
}

export async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowMs = 60_000,
): Promise<LimitResult> {
  const key = `${scope}:${identity}`;
  const durable = await store();

  if (durable?.kind === "redis") {
    try {
      const { count, ttl } = await redisCount(durable, `${KEY_PREFIX}:${key}`, windowMs);
      if (count > limit) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil(ttl / 1000)) };
      }
      return { ok: true, remaining: Math.max(0, limit - count) };
    } catch (error) {
      // A store outage should not take the site down; the instance still counts.
      console.error("[rate-limit] redis unavailable, counting in memory", error);
      return memoryLimit(key, limit, windowMs);
    }
  }

  if (durable?.kind === "r2") return r2Limit(durable.bucket, key, limit, windowMs);
  return memoryLimit(key, limit, windowMs);
}

export function limitedResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    {
      error: `Slow down for a few seconds — this feed is limited per visitor. Retry in ${retryAfter}s.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}

export type Guard =
  | { ok: false; response: NextResponse }
  | { ok: true; cookie: string | null; remaining: number | null };

export async function guard(
  request: Request,
  scope: string,
  limit: number,
  windowMs = 60_000,
): Promise<Guard> {
  const existing = visitorCookie(request);
  const ip = clientKey(request);
  const id = existing ?? crypto.randomUUID();

  if (!existing && !ip) {
    // Nothing to key on: let the request through untouched.
    return { ok: true, cookie: null, remaining: null };
  }

  const verdict = await rateLimit(scope, existing ?? `anon:${ip}`, limit, windowMs);
  if (!verdict.ok) return { ok: false, response: limitedResponse(verdict.retryAfter) };

  return {
    ok: true,
    cookie: existing ? null : `${COOKIE}=${id}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`,
    remaining: verdict.remaining,
  };
}

export function withGuardHeaders<T extends NextResponse>(response: T, result: Guard): T {
  if (result.ok) {
    if (result.cookie) response.headers.append("Set-Cookie", result.cookie);
    if (result.remaining !== null) {
      response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    }
  }
  return response;
}

export const LIMITS = {
  /** Sessions, driver lists and lap pairs: the expensive OpenF1 surface. */
  telemetry: { limit: 30, windowMs: 60_000 },
  /** The forecast is pure compute and cached per round, so it is cheaper. */
  forecast: { limit: 20, windowMs: 60_000 },
  /** Model calls cost money, so they are tighter: per visitor, per minute... */
  ai: { limit: 6, windowMs: 60_000 },
  /** ...and per visitor, per hour, so one visitor cannot camp the desk. */
  aiHourly: { limit: 30, windowMs: 3_600_000 },
} as const;
