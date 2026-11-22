import { raceStart } from "@/lib/f1";
import type { StrategyForecast } from "@/lib/strategy-forecast";

/**
 * The frozen pre-race log, shared by both models.
 *
 * A forecast is only a track record if it was written down before the race. So
 * the next race's call — the strategist's plan and the predictor's ranking — is
 * saved the first time it is built before the lights go out, and from then on the
 * entry is immutable: a later model tune cannot rewrite what was called that
 * week. Completed rounds are scored against their stored call; rounds from
 * before the log existed fall back to a replay.
 *
 * Storage is the deployment's R2 bucket (`NEXT_INC_CACHE_R2_BUCKET`, the same
 * one the rate-limit counters use), one JSON object per season per model. There
 * is no database to provision and nothing to migrate. Under plain `next dev`
 * there is no Worker binding, so the log goes to `.cache/pre-race-log/` instead,
 * which keeps local checks honest across a server restart; last resort is memory.
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

export type SavedRanking = {
  code: string;
  win: number;
  podium: number;
  points: number;
};

export type SavedPrediction = {
  season: number;
  round: number;
  raceName: string;
  date: string;
  start: string;
  savedAt: string;
  /** Every driver, best first, with the probabilities the model showed. */
  ranking: SavedRanking[];
};

export type SeasonLog<T> = {
  season: number;
  entries: Record<string, T>;
};

type ObjectBody = { json(): Promise<unknown> };
type Bucket = {
  get(key: string): Promise<ObjectBody | null>;
  put(key: string, value: string): Promise<unknown>;
};

const BINDING = "NEXT_INC_CACHE_R2_BUCKET";
const keyFor = (name: string, season: number) => `bp-${name}/${season}.json`;

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
        if (
          candidate &&
          typeof candidate.get === "function" &&
          typeof candidate.put === "function"
        ) {
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

type GlobalWithLog = typeof globalThis & { __bpPreRaceLog?: Map<string, SeasonLog<unknown>> };

function memoryLog(): Map<string, SeasonLog<unknown>> {
  const global = globalThis as GlobalWithLog;
  if (!global.__bpPreRaceLog) global.__bpPreRaceLog = new Map();
  return global.__bpPreRaceLog;
}

/** Plain `next dev`: no bucket, so the log sits in an ignored directory. */
function localPath(name: string, season: number): string {
  return `${process.env.PRE_RACE_LOG_DIR ?? ".cache/pre-race-log"}/${name}-${season}.json`;
}

async function readLocal<T>(name: string, season: number): Promise<SeasonLog<T> | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const data = JSON.parse(await readFile(localPath(name, season), "utf8")) as Partial<
      SeasonLog<T>
    >;
    if (data && data.entries && typeof data.entries === "object") {
      return { season, entries: data.entries };
    }
  } catch {
    // Missing file is the normal first-run case.
  }
  return null;
}

async function writeLocal<T>(name: string, log: SeasonLog<T>): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = localPath(name, log.season);
  const dir = path.slice(0, path.lastIndexOf("/")) || ".";
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(log, null, 2));
}

async function readSeason<T>(name: string, season: number): Promise<SeasonLog<T>> {
  const memoryKey = `${name}:${season}`;

  const store = await bucketStore();
  if (store) {
    try {
      const object = await store.get(keyFor(name, season));
      if (object) {
        const data = (await object.json()) as Partial<SeasonLog<T>> | null;
        if (data && data.entries && typeof data.entries === "object") {
          return { season, entries: data.entries };
        }
      }
    } catch (error) {
      console.warn(`[pre-race-log] ${name} read failed`, error);
    }
  }

  const local = await readLocal<T>(name, season);
  if (local) {
    memoryLog().set(memoryKey, local as SeasonLog<unknown>);
    return local;
  }
  return (memoryLog().get(memoryKey) as SeasonLog<T> | undefined) ?? { season, entries: {} };
}

async function writeSeason<T>(name: string, log: SeasonLog<T>): Promise<void> {
  memoryLog().set(`${name}:${log.season}`, log as SeasonLog<unknown>);

  const store = await bucketStore();
  if (store) {
    try {
      await store.put(keyFor(name, log.season), JSON.stringify(log));
    } catch (error) {
      console.warn(`[pre-race-log] ${name} write failed`, error);
    }
    return;
  }

  try {
    await writeLocal(name, log);
  } catch (error) {
    console.warn(`[pre-race-log] ${name} local write failed`, error);
  }
}

export const readForecastLog = (season: number): Promise<SeasonLog<SavedForecast>> =>
  readSeason<SavedForecast>("forecast", season);

export const readPredictLog = (season: number): Promise<SeasonLog<SavedPrediction>> =>
  readSeason<SavedPrediction>("predict", season);

/**
 * Save the strategist's call for a race that has not started yet. Returns the
 * stored entry (the existing one if this round was already frozen) or null when
 * the race has already begun, which is not a pre-race forecast at all.
 */
export async function saveForecast(
  season: number,
  forecast: StrategyForecast,
  now = new Date(),
): Promise<SavedForecast | null> {
  const start = raceStart(forecast.race);
  if (now.getTime() >= start.getTime()) return null;

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
    start: start.toISOString(),
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

  await writeSeason("forecast", {
    season,
    entries: { ...log.entries, [round]: entry },
  });
  return entry;
}

/**
 * Save the predictor's ranking for a race that has not started yet, with the
 * same immutability rule as the strategist's call.
 */
export async function savePrediction(
  season: number,
  prediction: {
    race: { round: number; name: string; date: string; time?: string };
    rows: Array<{ code: string; win: number; podium: number; points: number }>;
  },
  now = new Date(),
): Promise<SavedPrediction | null> {
  const start = raceStart(prediction.race);
  if (now.getTime() >= start.getTime()) return null;
  if (prediction.rows.length === 0) return null;

  const round = String(prediction.race.round);
  const log = await readPredictLog(season);
  const existing = log.entries[round];
  if (existing) return existing;

  const entry: SavedPrediction = {
    season,
    round: Number(prediction.race.round),
    raceName: prediction.race.name.replace(" Grand Prix", ""),
    date: prediction.race.date,
    start: start.toISOString(),
    savedAt: now.toISOString(),
    ranking: prediction.rows.map((row) => ({
      code: row.code,
      win: row.win,
      podium: row.podium,
      points: row.points,
    })),
  };

  await writeSeason("predict", {
    season,
    entries: { ...log.entries, [round]: entry },
  });
  return entry;
}
