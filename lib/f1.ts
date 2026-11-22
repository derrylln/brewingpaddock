import { cache } from "react";
import snapshotJson from "@/data/snapshot.json";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE = 300;
const TIMEOUT_MS = 12000;

export type ApiDriver = {
  driverId: string;
  permanentNumber?: string;
  code?: string;
  givenName: string;
  familyName: string;
  nationality: string;
  dateOfBirth?: string;
  url?: string;
};

export type ApiConstructor = {
  constructorId: string;
  name: string;
  nationality?: string;
  url?: string;
};

export type DriverStanding = {
  position: number;
  points: number;
  wins: number;
  driver: ApiDriver;
  constructor: ApiConstructor;
};

export type ConstructorStanding = {
  position: number;
  points: number;
  wins: number;
  constructor: ApiConstructor;
};

export type RaceSessionTime = { date: string; time?: string };

export type Race = {
  season: string;
  round: string;
  raceName: string;
  Circuit: {
    circuitId: string;
    circuitName: string;
    url?: string;
    Location: { lat: string; long: string; locality: string; country: string };
  };
  date: string;
  time?: string;
  FirstPractice?: RaceSessionTime;
  SecondPractice?: RaceSessionTime;
  ThirdPractice?: RaceSessionTime;
  Qualifying?: RaceSessionTime;
  Sprint?: RaceSessionTime;
  SprintQualifying?: RaceSessionTime;
  SprintShootout?: RaceSessionTime;
};

export type RaceResult = {
  number?: string;
  position: string;
  positionText: string;
  points: string;
  Driver: ApiDriver;
  Constructor: ApiConstructor;
  grid: string;
  laps: string;
  status: string;
  Time?: { millis?: string; time?: string };
  FastestLap?: { rank?: string; lap?: string; Time?: { time?: string } };
};

export type QualifyingResult = {
  number?: string;
  position: string;
  Driver: ApiDriver;
  Constructor: ApiConstructor;
  Q1?: string;
  Q2?: string;
  Q3?: string;
};

export type PitStop = {
  driverId: string;
  duration: string;
  lap: string;
  stop: string;
  time?: string;
};

export type SeasonResults = Array<{ round: number; raceName: string; results: RaceResult[] }>;

type Snapshot = {
  season: number;
  generatedAt: string;
  standings: DriverStanding[];
  constructors: ConstructorStanding[];
  schedule: Race[];
  seasonResults: SeasonResults;
  races: Record<string, { quali: QualifyingResult[]; pits: PitStop[] }>;
};

export const SNAPSHOT = snapshotJson as unknown as Snapshot;

type Envelope<T> = { MRData: T };

type StandingsEnvelope = {
  StandingsTable?: {
    season?: string;
    round?: string;
    StandingsLists?: Array<{
      DriverStandings?: Array<{
        position: string;
        points: string;
        wins: string;
        Driver: ApiDriver;
        Constructors: ApiConstructor[];
      }>;
      ConstructorStandings?: Array<{
        position: string;
        points: string;
        wins: string;
        Constructor: ApiConstructor;
      }>;
    }>;
  };
};

type RaceEnvelope = { RaceTable?: { season?: string; Races?: Race[] } };
type ResultsEnvelope = {
  total?: string;
  RaceTable?: { Races?: Array<Race & { Results?: RaceResult[] }> };
};
type QualiEnvelope = {
  RaceTable?: { Races?: Array<Race & { QualifyingResults?: QualifyingResult[] }> };
};
type PitEnvelope = {
  RaceTable?: { Races?: Array<Race & { PitStops?: PitStop[] }> };
};

/**
 * Jolpica rate-limits aggressively, and Cloudflare egress IPs are shared, so the deployed
 * Worker often gets a 429. Requests are throttled, retried with backoff, and after a 429 the
 * whole data layer rests on the bundled snapshot for a minute instead of hammering the API.
 */
let inFlight = 0;
const waiters: Array<() => void> = [];
const MAX_CONCURRENT = 2;
let cooldownUntil = 0;
const COOLDOWN_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquire() {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inFlight += 1;
}

function release() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

async function requestJson<T>(path: string, revalidate = REVALIDATE): Promise<T | null> {
  if (Date.now() < cooldownUntil) return null;

  await acquire();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(`${BASE}/${path}`, {
          headers: { Accept: "application/json" },
          next: { revalidate },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          cooldownUntil = 0;
          return (await res.json()) as T;
        }
        if (res.status === 429) {
          cooldownUntil = Date.now() + COOLDOWN_MS;
        }
        if (res.status !== 429 && res.status !== 503 && res.status < 500) return null;
      } catch {
        // network error — retry once below
      }
      await sleep(250 * (attempt + 1));
    }
    return null;
  } finally {
    release();
  }
}

/** Ergast/Jolpica statuses: "Finished" and "Lapped" are classifications, "+1 Lap" also finishes. */
export function isFinisher(status: string): boolean {
  return /^(finished|lapped)$/i.test(status) || status.trim().startsWith("+");
}

function mapStandings(data: Envelope<StandingsEnvelope> | null): DriverStanding[] {
  const list = data?.MRData.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
  return list.map((row) => ({
    position: Number(row.position),
    points: Number(row.points),
    wins: Number(row.wins),
    driver: row.Driver,
    constructor: row.Constructors?.[0] ?? { constructorId: "unknown", name: "—" },
  }));
}

async function fetchStandingsLive(season: number): Promise<DriverStanding[] | null> {
  const data = await requestJson<Envelope<StandingsEnvelope>>(
    `${season}/driverstandings.json?limit=40`,
  );
  if (!data) return null;
  return mapStandings(data);
}

async function fetchConstructorsLive(season: number): Promise<ConstructorStanding[] | null> {
  const data = await requestJson<Envelope<StandingsEnvelope>>(
    `${season}/constructorstandings.json?limit=20`,
  );
  if (!data) return null;
  const list = data.MRData.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [];
  return list.map((row) => ({
    position: Number(row.position),
    points: Number(row.points),
    wins: Number(row.wins),
    constructor: row.Constructor,
  }));
}

async function fetchScheduleLive(season: number): Promise<Race[] | null> {
  const data = await requestJson<Envelope<RaceEnvelope>>(`${season}/races.json?limit=40`);
  if (!data) return null;
  return data.MRData.RaceTable?.Races ?? [];
}

function snapshotOr<T>(season: number, live: T[] | null, fallback: T[]): T[] {
  if (live && live.length > 0) return live;
  return season === SNAPSHOT.season ? fallback : [];
}

export const getDriverStandings = cache(async (season: number): Promise<DriverStanding[]> =>
  snapshotOr(season, await fetchStandingsLive(season), SNAPSHOT.standings),
);

export const getConstructorStandings = cache(
  async (season: number): Promise<ConstructorStanding[]> =>
    snapshotOr(season, await fetchConstructorsLive(season), SNAPSHOT.constructors),
);

export const getSchedule = cache(async (season: number): Promise<Race[]> =>
  snapshotOr(season, await fetchScheduleLive(season), SNAPSHOT.schedule),
);

export const getRaceResults = cache(
  async (season: number, round: number | string): Promise<RaceResult[]> => {
    const data = await requestJson<Envelope<ResultsEnvelope>>(
      `${season}/${round}/results.json?limit=40`,
    );
    const live = data?.MRData.RaceTable?.Races?.[0]?.Results ?? [];
    if (live.length > 0) return live;
    if (season !== SNAPSHOT.season) return [];
    return SNAPSHOT.seasonResults.find((entry) => entry.round === Number(round))?.results ?? [];
  },
);

export const getQualifying = cache(
  async (season: number, round: number | string): Promise<QualifyingResult[]> => {
    const data = await requestJson<Envelope<QualiEnvelope>>(
      `${season}/${round}/qualifying.json?limit=40`,
    );
    const live = data?.MRData.RaceTable?.Races?.[0]?.QualifyingResults ?? [];
    if (live.length > 0) return live;
    if (season !== SNAPSHOT.season) return [];
    return SNAPSHOT.races[String(round)]?.quali ?? [];
  },
);

export const getPitStops = cache(
  async (season: number, round: number | string): Promise<PitStop[]> => {
    const data = await requestJson<Envelope<PitEnvelope>>(
      `${season}/${round}/pitstops.json?limit=200`,
    );
    const live = data?.MRData.RaceTable?.Races?.[0]?.PitStops ?? [];
    if (live.length > 0) return live;
    if (season !== SNAPSHOT.season) return [];
    return SNAPSHOT.races[String(round)]?.pits ?? [];
  },
);

/**
 * Every result row of the season. Jolpica paginates result ROWS (max 100 per page), so a race
 * can span pages: fetch every page, then merge the partial classifications back by round.
 */
export const getSeasonResults = cache(async (season: number): Promise<SeasonResults> => {
  const path = (offset: number) => `${season}/results.json?limit=100&offset=${offset}`;
  const first = await requestJson<Envelope<ResultsEnvelope>>(path(0), 600);

  if (!first) {
    return season === SNAPSHOT.season ? SNAPSHOT.seasonResults : [];
  }

  const total = Number(first.MRData.total ?? 0);
  const extraPages = Math.max(0, Math.ceil(total / 100) - 1);
  // Offsets are known once the total is in, so the remaining pages go out together
  // instead of one after another. The request gate still caps concurrency.
  const rest = await Promise.all(
    Array.from({ length: extraPages }, (_, index) =>
      requestJson<Envelope<ResultsEnvelope>>(path((index + 1) * 100), 600),
    ),
  );

  const byRound = new Map<number, { round: number; raceName: string; results: RaceResult[] }>();
  for (const page of [first, ...rest]) {
    for (const race of page?.MRData.RaceTable?.Races ?? []) {
      const round = Number(race.round);
      const entry = byRound.get(round) ?? { round, raceName: race.raceName, results: [] };
      for (const result of race.Results ?? []) {
        if (!entry.results.some((row) => row.Driver.driverId === result.Driver.driverId)) {
          entry.results.push(result);
        }
      }
      byRound.set(round, entry);
    }
  }

  const merged = [...byRound.values()]
    .map((entry) => ({
      ...entry,
      results: entry.results.sort((a, b) => Number(a.position) - Number(b.position)),
    }))
    .sort((a, b) => a.round - b.round);

  if (merged.length > 0) return merged;
  return season === SNAPSHOT.season ? SNAPSHOT.seasonResults : [];
});

export type SeasonOverview = {
  season: number;
  source: "live" | "snapshot";
  standings: DriverStanding[];
  constructors: ConstructorStanding[];
  schedule: Race[];
  nextRace: Race | null;
  lastRace: Race | null;
  lastPodium: RaceResult[];
  completedRounds: number;
  today: string;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pick the newest season that actually has standings, so a fresh January still renders. */
export const resolveSeason = cache(async (): Promise<number> => {
  const year = new Date().getUTCFullYear();
  const live = await fetchStandingsLive(year);
  if (live && live.length > 0) return year;
  if (year === SNAPSHOT.season && SNAPSHOT.standings.length > 0) return year;
  return year - 1;
});

export const getSeasonOverview = cache(async (): Promise<SeasonOverview> => {
  const season = await resolveSeason();

  const liveStandings = await fetchStandingsLive(season);
  const source: SeasonOverview["source"] =
    liveStandings && liveStandings.length > 0 ? "live" : "snapshot";

  const standings = snapshotOr(season, liveStandings, SNAPSHOT.standings);
  const constructors = await getConstructorStandings(season);
  const schedule = await getSchedule(season);

  const today = isoToday();
  const nextRace = schedule.find((race) => race.date >= today) ?? null;
  const past = schedule.filter((race) => race.date < today);
  const lastRace = past.length > 0 ? past[past.length - 1] : null;
  const lastPodium = lastRace ? (await getRaceResults(season, lastRace.round)).slice(0, 3) : [];

  return {
    season,
    source,
    standings,
    constructors,
    schedule,
    nextRace,
    lastRace,
    lastPodium,
    completedRounds: past.length,
    today,
  };
});
