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
 * Counters live in the deployment's R2 bucket (`NEXT_INC_CACHE_R2_BUCKET`), not
 * isolate memory: requests are spread across fresh isolates, so an in-memory
 * bucket never accumulates and a "limit" that never fires is worse than none.
 * When the binding is absent (plain `next dev`), it falls back to memory.
 */

type Bucket = { hits: number[] };
type R2Like = {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(key: string, value: string): Promise<unknown>;
};

const memory = new Map<string, Bucket>();
const COOKIE = "bp-vid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const KEY_PREFIX = "bp-ratelimit";
let lastSweep = Date.now();
let resolvedStore: R2Like | null | undefined;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of memory) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > 10 * 60_000) {
      memory.delete(key);
    }
  }
}

async function store(): Promise<R2Like | null> {
  if (resolvedStore !== undefined) return resolvedStore;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = (ctx?.env ?? {}) as Record<string, unknown>;
    const candidate = env.NEXT_INC_CACHE_R2_BUCKET as R2Like | undefined;
    resolvedStore = candidate && typeof candidate.get === "function" ? candidate : null;
  } catch {
    resolvedStore = null;
  }
  return resolvedStore;
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

export async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowMs = 60_000,
): Promise<LimitResult> {
  const now = Date.now();
  const key = `${scope}:${identity}`;
  const durable = await store();

  if (!durable) {
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

  const objectKey = `${KEY_PREFIX}/${scope}/${encodeURIComponent(identity)}.json`;
  let hits: number[] = [];
  try {
    const existing = await durable.get(objectKey);
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
    await durable.put(objectKey, JSON.stringify({ hits: [...hits, now] }));
  } catch {
    // Same for writes: the request is allowed, the counter is just best-effort.
  }
  return verdict;
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
  /** Model calls cost money, so they are tighter. */
  ai: { limit: 8, windowMs: 60_000 },
} as const;
