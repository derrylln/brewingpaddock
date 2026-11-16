/**
 * Server-only LLM client.
 *
 * Talks the OpenAI chat-completions shape over plain fetch, which Gemini serves
 * at its compatibility endpoint — so the same code runs in `next dev` and in the
 * Cloudflare Workers runtime, with no SDK and no Node built-ins.
 *
 * Configure with one secret:
 *   GEMINI_API_KEY   (also accepted: GOOGLE_API_KEY, AI_API_KEY)
 * Optional:
 *   AI_MODEL         default gemini-3.5-flash
 *   AI_API_BASE      default https://generativelanguage.googleapis.com/v1beta/openai
 *
 * Any other OpenAI-compatible endpoint works too by setting AI_API_BASE
 * (e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1).
 *
 * Gemini 3 always thinks, and those thought tokens count against max_output_tokens
 * (`max_tokens` here). A tight cap therefore returns a sentence cut in half, which
 * is why Gemini requests ask for minimal reasoning, add headroom, and retry once if
 * the provider still reports a length stop.
 *
 * Nothing here is imported by a client component except as a type, so the key
 * stays on the server and is never shipped to the browser.
 */

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
// gemini-2.5-flash is deprecated and re-routes after 1 December 2026, so the
// default is a current model, with a cheaper sibling as the fallback.
const DEFAULT_MODEL = "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
const TIMEOUT_MS = 20_000;
/** Thought tokens are billed and counted against the cap; leave room for them. */
const THINKING_HEADROOM = 600;

export type AiRead =
  | { text: string; source: "ai"; model: string }
  | { text: string; source: "model"; model: null };

/** A successful generation, tagged with the model that actually answered. */
export type AiCompletion = { text: string; model: string };

type Request = { system: string; user: string; maxTokens: number; temperature: number };

function apiKey(): string {
  const raw =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.AI_API_KEY ??
    process.env.ZAI_API_KEY ??
    "";
  return raw.trim();
}

function apiBase(): string {
  const base = (process.env.AI_API_BASE ?? process.env.ZAI_API_BASE ?? "").trim() || DEFAULT_BASE;
  return base.replace(/\/+$/, "");
}

export function aiModel(): string {
  return (process.env.AI_MODEL ?? "").trim() || DEFAULT_MODEL;
}

export function aiEnabled(): boolean {
  return apiKey().length > 0;
}

/** Gemini's compat layer accepts reasoning_effort; plain OpenAI-style endpoints do not. */
function isGemini(base: string): boolean {
  return /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(base);
}

/**
 * Per-isolate spend guard. The preview URL is public, so every generated word is
 * the owner's money: cap generation per worker instance instead of trusting the
 * visitor. Over budget, callers fall back to the computed read.
 */
const LIMIT_PER_MINUTE = 20;
const LIMIT_PER_HOUR = 240;
const calls: number[] = [];

function withinBudget(now: number): boolean {
  while (calls.length > 0 && now - calls[0] > 3_600_000) calls.shift();
  if (calls.length >= LIMIT_PER_HOUR) return false;
  let lastMinute = 0;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (now - calls[i] > 60_000) break;
    lastMinute += 1;
  }
  return lastMinute < LIMIT_PER_MINUTE;
}

type Attempt = { ok: boolean; status: number; text?: string; truncated?: boolean; detail?: string };

async function attempt(
  model: string,
  key: string,
  req: Request,
  options: { cap: number | null; reasoning: string | null },
): Promise<Attempt> {
  const body: Record<string, unknown> = {
    model,
    temperature: req.temperature,
    stream: false,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };
  if (options.cap) body.max_tokens = options.cap;
  if (options.reasoning) body.reasoning_effort = options.reasoning;

  const res = await fetch(`${apiBase()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240);
    return { ok: false, status: res.status, detail };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const text = (choice?.message?.content ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 24) return { ok: false, status: res.status };
  return { ok: true, status: res.status, text, truncated: choice?.finish_reason === "length" };
}

export async function aiText(request: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<AiCompletion | null> {
  const key = apiKey();
  if (!key) return null;

  const now = Date.now();
  if (!withinBudget(now)) return null;
  calls.push(now);

  const base = apiBase();
  const req: Request = {
    system: request.system,
    user: request.user,
    maxTokens: request.maxTokens ?? 260,
    temperature: request.temperature ?? 0.35,
  };
  const gemini = isGemini(base);
  const cap = gemini ? req.maxTokens + THINKING_HEADROOM : req.maxTokens;
  const reasoning = gemini ? "minimal" : null;
  const models = [...new Set([aiModel(), ...FALLBACK_MODELS])];

  for (const model of models) {
    try {
      let res = await attempt(model, key, req, { cap, reasoning });

      // A model that will not take reasoning_effort: drop it, keep the cap.
      if (!res.ok && res.status === 400 && res.detail && /reasoning_effort|thinking/i.test(res.detail)) {
        res = await attempt(model, key, req, { cap, reasoning: null });
      }
      // Some compatibility layers reject max_tokens outright.
      if (!res.ok && res.status === 400 && res.detail && /max_tokens/i.test(res.detail)) {
        res = await attempt(model, key, req, { cap: null, reasoning });
      }

      if (res.ok && res.text) {
        if (!res.truncated) return { text: res.text, model };

        // Still cut off: thinking crowded out the answer. One retry with more room.
        const roomier = await attempt(model, key, req, { cap: cap * 2, reasoning });
        if (roomier.ok && roomier.text && !roomier.truncated) {
          return { text: roomier.text, model };
        }
        console.error(`[ai] ${model} response truncated past ${cap * 2} tokens`);
        return null;
      }

      console.error(`[ai] ${model} ${res.status} ${res.detail ?? "empty response"}`);

      // Only an unknown model is worth another attempt; auth, quota and billing
      // errors would fail identically on every model.
      if (res.status !== 404) return null;
    } catch (error) {
      console.error(`[ai] ${model} request failed`, error);
      return null;
    }
  }

  return null;
}
