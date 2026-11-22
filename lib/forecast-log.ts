import type { StrategyForecast } from "@/lib/strategy-forecast";

/**
 * The frozen forecast log.
 *
 * A forecast is only a track record if it was written down before the race. So
 * the next race's forecast is saved the first time it is computed before the
 * lights go out, and from then on the entry is immutable: a later model tune
 * cannot rewrite what was called that week. Completed rounds are scored against
 * their stored call; rounds from before the log existed fall back to a replay.
 *
 * Storage is the deployment's R2 bucket (`NEXT_INC_CACHE_R2_BUCKET`, the same
 * one the rate-limit counters use), one JSON object per season. There is no
 * database to provision and nothing to migrate. Under plain `next dev` there is
 * no Worker binding, so the log goes to `.cache/forecast-log/` instead, which
 * keeps local checks honest across a server restart; last resort is memory.
 */

export type SavedPlan = {
  label: string;
  stops: number;
  pitLaps: number[];
  probability: number;
};

export type SavedForecast = {
  season: number;
  round: number;
  raceName: string;
  circuitName: string;
  date: string;
  /** Scheduled start in ISO form; the cutoff for calling it a pre-race save. */
  start: string;
  /** When the entry was written. */
  savedAt: string;
  favourite: SavedPlan;
  /** Every priced plan, so a later tune can be compared with the call made then. */
  plans: SavedPlan[];
  scenarios: number;
  call: string;
};

export type ForecastLog = {
  season: number;
  entries: Record<string, SavedForecast>;
};

type ObjectBody = { json(): Promise<unknown> };
type Bucket = {
  get(key: string): Promise<ObjectBody | null>;
  put(key: string, value: string): Promise<unknown>;
};

const BINDING = "NEXT_INC_CACHE_R2_BUCKET";
const keyFor = (season: number) => `bp-forecast/${season}.json`;

let resolved: Promise<Bucket | null> | null = null;

function bucketStore(): Promise<Bucket | null> {
  if (!resolved) {
    resolved = (async () => {
      try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        const ctx = await getCloudflareContext({ async: true });
        const candidate = ((ctx?.env ?? {}) as Record<string, unknown>)[BINDING] as
          | Bucket
          | undefined;
        if (candidate && typeof candidate.get === "function" && typeof candidate.put === "function") {
          return candidate;
        }
      } catch {
        // No Worker context: plain `next dev`.
      }
      return null;
    })();
  }
  return resolved;
}

type GlobalWithLog = typeof globalThis & { __bpForecastLog?: Map<number, ForecastLog> };

function memoryLog(): Map<number, ForecastLog> {
  const global = globalThis as GlobalWithLog;
  if (!global.__bpForecastLog) global.__bpForecastLog = new Map();
  return global.__bpForecastLog;
}

/** Race start in UTC. A missing session time means the date alone is the cutoff. */
export function startAt(race: { date: string; time?: string }): Date {
  const time = race.time?.trim();
  if (time) {
    const stamp = `${race.date}T${time}`;
    const parsed = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(stamp) ? stamp : `${stamp}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallback = new Date(`${race.date}T00:00:00Z`);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

function emptyLog(season: number): ForecastLog {
  return { season, entries: {} };
}

/** Plain `next dev`: no bucket, so the log sits in an ignored directory. */
function localPath(season: number): string {
  return `${process.env.FORECAST_LOG_DIR ?? ".cache/forecast-log"}/${season}.json`;
}

async function readLocal(season: number): Promise<ForecastLog | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const data = JSON.parse(await readFile(localPath(season), "utf8")) as Partial<ForecastLog>;
    if (data && data.entries && typeof data.entries === "object") {
      return { season, entries: data.entries as Record<string, SavedForecast> };
    }
  } catch {
    // Missing file is the normal first-run case.
  }
  return null;
}

async function writeLocal(log: ForecastLog): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = localPath(log.season);
  const dir = path.slice(0, path.lastIndexOf("/")) || ".";
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(log, null, 2));
}

export async function readForecastLog(season: number): Promise<ForecastLog> {
  const store = await bucketStore();
  if (store) {
    try {
      const object = await store.get(keyFor(season));
      if (object) {
        const data = (await object.json()) as Partial<ForecastLog> | null;
        if (data && data.entries && typeof data.entries === "object") {
          return { season, entries: data.entries as Record<string, SavedForecast> };
        }
      }
    } catch (error) {
      console.warn("[forecast-log] read failed", error);
    }
  }
  const local = await readLocal(season);
  if (local) {
    memoryLog().set(season, local);
    return local;
  }
  return memoryLog().get(season) ?? emptyLog(season);
}

/**
 * Save the call for a race that has not started yet. Returns the stored entry
 * (the existing one if this round was already frozen) or null when the race has
 * already begun, which is not a pre-race forecast at all.
 */
export async function saveForecast(
  season: number,
  forecast: StrategyForecast,
  now = new Date(),
): Promise<SavedForecast | null> {
  if (now.getTime() >= startAt(forecast.race).getTime()) return null;

  const favourite = forecast.plans[0];
  if (!favourite) return null;

  const round = String(forecast.race.round);
  const log = await readForecastLog(season);
  const existing = log.entries[round];
  if (existing) return existing;

  const entry: SavedForecast = {
    season,
    round: Number(forecast.race.round),
    raceName: forecast.race.name.replace(" Grand Prix", ""),
    circuitName: forecast.race.circuitName,
    date: forecast.race.date,
    start: startAt(forecast.race).toISOString(),
    savedAt: now.toISOString(),
    favourite: {
      label: favourite.label,
      stops: favourite.stops,
      pitLaps: favourite.pitLaps,
      probability: favourite.probability,
    },
    plans: forecast.plans.map((plan) => ({
      label: plan.label,
      stops: plan.stops,
      pitLaps: plan.pitLaps,
      probability: plan.probability,
    })),
    scenarios: forecast.scenarios,
    call: forecast.call,
  };

  const next: ForecastLog = { season, entries: { ...log.entries, [round]: entry } };
  memoryLog().set(season, next);

  const store = await bucketStore();
  if (store) {
    try {
      await store.put(keyFor(season), JSON.stringify(next));
    } catch (error) {
      console.warn("[forecast-log] write failed", error);
    }
  } else {
    try {
      await writeLocal(next);
    } catch (error) {
      console.warn("[forecast-log] local write failed", error);
    }
  }

  return entry;
}
