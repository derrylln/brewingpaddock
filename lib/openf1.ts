import { cached } from "@/lib/cache";
import {
  CACHED_TELEMETRY,
  downsample,
  withDistance,
  type LapTrace,
  type TelemetryPayload,
  type TelemetryPoint,
} from "@/lib/telemetry";

const BASE = "https://api.openf1.org/v1";
const UA = "BrewingPaddock/1.0 (telemetry desk)";
/** Laps quicker or slower than this are out-laps, in-laps or red-flag junk. */
const MIN_LAP = 55;
const MAX_LAP = 200;

const TTL = {
  sessions: 15 * 60_000,
  laps: 30 * 60_000,
  drivers: 30 * 60_000,
  traces: 60 * 60_000,
  pair: 5 * 60_000,
};

type OpenF1Session = {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  year: number;
  circuit_short_name: string;
  country_name: string;
  is_cancelled?: boolean;
};

type OpenF1Driver = {
  driver_number: number;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
};

type OpenF1Lap = {
  driver_number: number;
  lap_number: number;
  date_start: string;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean;
  is_pit_in_lap?: boolean;
};

type OpenF1CarSample = {
  date: string;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  n_gear: number | null;
  drs: number | null;
};

/** What the picker needs to offer a session. */
export type SessionOption = {
  key: number;
  name: string;
  type: string;
  circuit: string;
  country: string;
  date: string;
  year: number;
};

export type LapOption = { lap: number; time: number };

export type DriverOption = {
  number: number;
  code: string;
  name: string;
  team: string;
  colour: string;
  laps: LapOption[];
};

/** Long-run pace from a practice session, scored 0..1 against the session best. */
export type WeekendPace = {
  session: string;
  sessionKey: number;
  date: string;
  pace: Record<string, number>;
  drivers: number;
};

async function of1<T>(path: string, timeout = 9000, attempts = 1): Promise<T | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json", "User-Agent": UA },
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return (await res.json()) as T;
      // 429 is OpenF1 throttling a burst, not a dead endpoint: wait and retry.
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      if (attempt === attempts) return null;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
  }
  return null;
}

/** Valid green-flag laps only: no out-laps, in-laps, red flags or safety-car crawls. */
function usableLap(lap: OpenF1Lap): boolean {
  const time = lap.lap_duration;
  if (!time || lap.is_pit_out_lap || lap.is_pit_in_lap) return false;
  return time >= MIN_LAP && time <= MAX_LAP;
}

function traceFrom(lap: OpenF1Lap, driver: OpenF1Driver, points: TelemetryPoint[]): LapTrace {
  return {
    number: driver.driver_number,
    code: driver.name_acronym,
    name: driver.full_name,
    team: driver.team_name,
    colour: `#${driver.team_colour || "888888"}`,
    lapNumber: lap.lap_number,
    lapTime: lap.lap_duration ?? 0,
    sectors: [
      lap.duration_sector_1 ?? 0,
      lap.duration_sector_2 ?? 0,
      lap.duration_sector_3 ?? 0,
    ],
    points,
  };
}

async function rawSessions(): Promise<OpenF1Session[]> {
  const year = new Date().getUTCFullYear();
  return cached(
    `openf1:sessions:${year}`,
    TTL.sessions,
    async () => {
      let sessions = await of1<OpenF1Session[]>(`/sessions?year=${year}`, 12000, 2);
      if (!sessions || sessions.length === 0) {
        sessions = await of1<OpenF1Session[]>(`/sessions?year=${year - 1}`, 12000, 2);
      }
      if (!sessions || sessions.length === 0) throw new Error("OpenF1 session list unavailable");
      return sessions
        .filter((s) => !s.is_cancelled && Date.parse(s.date_start) < Date.now())
        .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
    },
  );
}

function cachedSessions(): SessionOption[] {
  return [
    {
      key: CACHED_TELEMETRY.session.sessionKey,
      name: CACHED_TELEMETRY.session.name,
      type: "Race",
      circuit: CACHED_TELEMETRY.session.circuit,
      country: CACHED_TELEMETRY.session.country,
      date: CACHED_TELEMETRY.session.date,
      year: CACHED_TELEMETRY.session.year,
    },
  ];
}

function cachedDrivers(): DriverOption[] {
  return CACHED_TELEMETRY.drivers.map((driver) => ({
    number: driver.number,
    code: driver.code,
    name: driver.name,
    team: driver.team,
    colour: driver.colour,
    laps: [{ lap: driver.lapNumber, time: driver.lapTime }],
  }));
}

/** Sessions a visitor can pick from: the latest races, qualifying and sprints. */
export async function getSessionOptions(): Promise<{ options: SessionOption[]; live: boolean }> {
  try {
    const sessions = await rawSessions();
    const picked = sessions
      .filter((s) =>
        ["Race", "Qualifying", "Sprint", "Sprint Qualifying", "Sprint Shootout"].includes(s.session_name),
      )
      .slice(0, 12)
      .map<SessionOption>((s) => ({
        key: s.session_key,
        name: s.session_name,
        type: s.session_type,
        circuit: s.circuit_short_name,
        country: s.country_name,
        date: s.date_start,
        year: s.year,
      }));

    if (picked.length === 0) return { options: cachedSessions(), live: false };
    return { options: picked, live: true };
  } catch {
    return { options: cachedSessions(), live: false };
  }
}

async function sessionLaps(sessionKey: number): Promise<OpenF1Lap[] | null> {
  try {
    return await cached(
      `openf1:laps:${sessionKey}`,
      TTL.laps,
      async () => {
        const laps = await of1<OpenF1Lap[]>(`/laps?session_key=${sessionKey}`, 14000, 2);
        if (!laps || laps.length === 0) throw new Error("OpenF1 lap list unavailable");
        return laps;
      },
    );
  } catch {
    return null;
  }
}

async function sessionDrivers(sessionKey: number): Promise<OpenF1Driver[] | null> {
  try {
    return await cached(
      `openf1:drivers:${sessionKey}`,
      TTL.drivers,
      async () => {
        const drivers = await of1<OpenF1Driver[]>(`/drivers?session_key=${sessionKey}`, 12000, 2);
        if (!drivers || drivers.length === 0) throw new Error("OpenF1 driver list unavailable");
        return drivers;
      },
    );
  } catch {
    return null;
  }
}

/** Every driver in a session, with the laps they actually set. */
export async function getDriverOptions(sessionKey: number): Promise<{ options: DriverOption[]; session: SessionOption | null; live: boolean }> {
  const [drivers, laps] = await Promise.all([
    sessionDrivers(sessionKey),
    sessionLaps(sessionKey),
  ]);

  if (!drivers || !laps) {
    const sessions = await getSessionOptions();
    return {
      options: cachedDrivers(),
      session: sessions.options.find((s) => s.key === sessionKey) ?? sessions.options[0] ?? null,
      live: false,
    };
  }

  const byDriver = new Map<number, LapOption[]>();
  for (const lap of laps) {
    if (!usableLap(lap)) continue;
    const list = byDriver.get(lap.driver_number) ?? [];
    list.push({ lap: lap.lap_number, time: lap.lap_duration as number });
    byDriver.set(lap.driver_number, list);
  }

  const options = drivers
    .map<DriverOption>((driver) => ({
      number: driver.driver_number,
      code: driver.name_acronym,
      name: driver.full_name,
      team: driver.team_name,
      colour: `#${driver.team_colour || "888888"}`,
      laps: (byDriver.get(driver.driver_number) ?? []).sort((a, b) => a.lap - b.lap),
    }))
    .filter((driver) => driver.laps.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  if (options.length === 0) {
    const sessions = await getSessionOptions();
    return { options: cachedDrivers(), session: sessions.options[0] ?? null, live: false };
  }

  const sessions = await getSessionOptions();
  return {
    options,
    session: sessions.options.find((s) => s.key === sessionKey) ?? null,
    live: true,
  };
}

function fallback(note: string): TelemetryPayload {
  return {
    ...CACHED_TELEMETRY,
    source: "cached",
    fetchedAt: new Date().toISOString(),
    note,
  };
}

function pickFastestLaps(laps: OpenF1Lap[]): OpenF1Lap[] {
  const best = new Map<number, OpenF1Lap>();
  for (const lap of laps) {
    if (!usableLap(lap)) continue;
    const current = best.get(lap.driver_number);
    if (!current || (current.lap_duration ?? 999) > (lap.lap_duration ?? 999)) {
      best.set(lap.driver_number, lap);
    }
  }
  return [...best.values()].sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
}

async function carTrace(
  sessionKey: number,
  lap: OpenF1Lap,
  driver: OpenF1Driver,
): Promise<LapTrace | null> {
  try {
    return await cached(
      `openf1:trace:${sessionKey}:${lap.driver_number}:${lap.lap_number}`,
      TTL.traces,
      async () => {
        const start = new Date(lap.date_start).getTime();
        const end = start + ((lap.lap_duration ?? 90) + 4) * 1000;
        const params =
          `/car_data?session_key=${sessionKey}&driver_number=${lap.driver_number}` +
          `&date%3E=${new Date(start).toISOString()}&date%3C=${new Date(end).toISOString()}`;

        let samples: OpenF1CarSample[] | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          samples = await of1<OpenF1CarSample[]>(params, 20000);
          if (samples && samples.length >= 20) break;
          samples = null;
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        if (!samples) throw new Error("OpenF1 car data unavailable for that lap");

        const raw = samples.map((s) => ({
          ts: Date.parse(s.date),
          v: s.speed ?? 0,
          th: s.throttle ?? 0,
          br: s.brake ?? 0,
          g: s.n_gear ?? 0,
          drs: s.drs ?? 0,
        }));
        return traceFrom(lap, driver, downsample(withDistance(raw), 320));
      },
    );
  } catch {
    return null;
  }
}

const PRACTICE_SESSIONS = ["Practice 1", "Practice 2", "Practice 3"];

/**
 * Practice long-run pace for a race meeting, from the latest practice session
 * that has run. Best effort: no meeting in the window, a throttled session or
 * too few clean laps all return null, and the predictor keeps its quantified
 * form. Keyed by driver acronym so it joins the classification rows directly.
 */
export async function getWeekendPace(meeting: {
  date: string;
  country: string;
}): Promise<WeekendPace | null> {
  if (!meeting.date) return null;

  return cached(
    `openf1:practice:${meeting.date}:${meeting.country}`,
    TTL.laps,
    async (): Promise<WeekendPace | null> => {
      const sessions = await rawSessions();
      const day = Date.parse(`${meeting.date}T00:00:00Z`);
      if (!Number.isFinite(day)) return null;

      // The meeting runs in the days before the race; five days covers a
      // Thursday start at a flyaway without reaching the previous round.
      const candidates = sessions
        .filter((session) => PRACTICE_SESSIONS.includes(session.session_name))
        .filter((session) => {
          const start = Date.parse(session.date_start);
          return (
            Number.isFinite(start) &&
            start <= day + 86_400_000 &&
            start >= day - 5 * 86_400_000
          );
        });
      const circuits = new Set(candidates.map((session) => session.circuit_short_name));
      const wanted = candidates.filter((session) =>
        session.country_name.toLowerCase().includes(meeting.country.toLowerCase().slice(0, 5)),
      );
      const pool = wanted.length > 0 ? wanted : circuits.size === 1 ? candidates : [];
      const session = pool.sort(
        (a, b) => Date.parse(b.date_start) - Date.parse(a.date_start),
      )[0];
      if (!session) return null;

      const [laps, drivers] = await Promise.all([
        sessionLaps(session.session_key),
        sessionDrivers(session.session_key),
      ]);
      if (!laps || !drivers) return null;

      const byDriver = new Map<number, number[]>();
      for (const lap of laps) {
        if (!usableLap(lap)) continue;
        const list = byDriver.get(lap.driver_number) ?? [];
        list.push(lap.lap_duration as number);
        byDriver.set(lap.driver_number, list);
      }

      // Long-run pace: strip the traffic and cool-down laps that sit far off a
      // driver's own best, then take the median of what is left. A single best
      // lap would just re-measure qualifying.
      const longRuns = new Map<number, number>();
      for (const [number, times] of byDriver) {
        if (times.length < 3) continue;
        const best = Math.min(...times);
        const clean = times.filter((time) => time <= best * 1.07).sort((a, b) => a - b);
        if (clean.length === 0) continue;
        const mid = Math.floor(clean.length / 2);
        longRuns.set(
          number,
          clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid],
        );
      }
      if (longRuns.size < 10) return null;

      const reference = Math.min(...longRuns.values());
      const pace: Record<string, number> = {};
      for (const driver of drivers) {
        const time = longRuns.get(driver.driver_number);
        if (time === undefined) continue;
        pace[driver.name_acronym] = Math.max(0, Math.min(1, Math.exp(-(time - reference) / 1.2)));
      }
      if (Object.keys(pace).length < 10) return null;

      return {
        session: session.session_name,
        sessionKey: session.session_key,
        date: session.date_start,
        pace,
        drivers: Object.keys(pace).length,
      };
    },
  );
}

/** The pair a visitor asked for, by session + driver + lap. */
export async function getSelectedTelemetry(request: {
  sessionKey: number;
  a: number;
  lapA: number;
  b: number;
  lapB: number;
}): Promise<TelemetryPayload> {
  const { sessionKey, a, lapA, b, lapB } = request;

  if (sessionKey === CACHED_TELEMETRY.session.sessionKey) {
    // The bundled pair is the same race; anything else on that session needs the network.
    const cachedMatch =
      CACHED_TELEMETRY.drivers.find((d) => d.number === a && d.lapNumber === lapA) &&
      CACHED_TELEMETRY.drivers.find((d) => d.number === b && d.lapNumber === lapB);
    if (cachedMatch) {
      return fallback("Bundled Interlagos pair — instant, no network needed.");
    }
  }

  return cached(
    `telemetry:pair:${sessionKey}:${a}:${lapA}:${b}:${lapB}`,
    TTL.pair,
    async () => {
      const [drivers, laps] = await Promise.all([
        sessionDrivers(sessionKey),
        sessionLaps(sessionKey),
      ]);
      if (!drivers || !laps) {
        throw new Error("OpenF1 is throttling right now. Try again in a few seconds.");
      }

      const driverA = drivers.find((d) => d.driver_number === a);
      const driverB = drivers.find((d) => d.driver_number === b);
      const lapAEntry = laps.find((l) => l.driver_number === a && l.lap_number === lapA && usableLap(l));
      const lapBEntry = laps.find((l) => l.driver_number === b && l.lap_number === lapB && usableLap(l));
      if (!driverA || !driverB || !lapAEntry || !lapBEntry) {
        throw new Error("That lap is not a clean flying lap. Pick another lap.");
      }

      // Sequential on purpose: two car_data calls in the same tick is exactly the
      // burst OpenF1 throttles.
      const traceA = await carTrace(sessionKey, lapAEntry, driverA);
      const traceB = traceA ? await carTrace(sessionKey, lapBEntry, driverB) : null;
      if (!traceA || !traceB) {
        throw new Error("OpenF1 has no car data for one of those laps. Try another lap.");
      }

      const sessions = await getSessionOptions();
      const meta = sessions.options.find((s) => s.key === sessionKey);
      return {
        source: "live" as const,
        session: {
          sessionKey,
          year: meta?.year ?? new Date().getUTCFullYear(),
          name: meta?.name ?? "Session",
          circuit: meta?.circuit ?? "Circuit",
          country: meta?.country ?? "",
          date: meta?.date ?? new Date().toISOString(),
        },
        drivers: [traceA, traceB],
        fetchedAt: new Date().toISOString(),
        note: "Chosen laps, distance-aligned and sampled at ~3.7 Hz from OpenF1.",
      };
    },
  );
}

/** Default view: the two fastest laps of the latest race. */
async function liveTelemetry(): Promise<TelemetryPayload> {
  const sessions = await rawSessions();
  const races = sessions.filter((s) => s.session_name === "Race");
  if (races.length === 0) throw new Error("No completed race in the OpenF1 window");
  const session = races[0];

  const [drivers, laps] = await Promise.all([
    sessionDrivers(session.session_key),
    sessionLaps(session.session_key),
  ]);
  if (!drivers || !laps) throw new Error("OpenF1 is throttling right now.");

  const fastest = pickFastestLaps(laps).slice(0, 2);
  if (fastest.length < 2) throw new Error("No clean pair in the latest race");

  const traces: LapTrace[] = [];
  for (const lap of fastest) {
    const driver = drivers.find((d) => d.driver_number === lap.driver_number);
    if (!driver) continue;
    const trace = await carTrace(session.session_key, lap, driver);
    if (trace) traces.push(trace);
  }
  if (traces.length < 2) throw new Error("The fastest pair has incomplete car data");

  return {
    source: "live",
    session: {
      sessionKey: session.session_key,
      year: session.year,
      name: session.session_name,
      circuit: session.circuit_short_name,
      country: session.country_name,
      date: session.date_start,
    },
    drivers: [traces[0], traces[1]],
    fetchedAt: new Date().toISOString(),
    note: "Fastest race lap of each driver, sampled at ~3.7 Hz from OpenF1.",
  };
}

export async function getTelemetry(): Promise<TelemetryPayload> {
  try {
    return await cached("telemetry:default", TTL.pair, () => liveTelemetry());
  } catch {
    return fallback("Live OpenF1 feed unavailable — showing the cached Interlagos 2026 pair.");
  }
}
