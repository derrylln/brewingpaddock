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
const TTL = 10 * 60 * 1000;
/** Laps quicker or slower than this are out-laps, in-laps or red-flag junk. */
const MIN_LAP = 55;
const MAX_LAP = 200;

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

type CacheEntry<T> = { at: number; data: T };

const sessionOptionsCache = new Map<string, CacheEntry<SessionOption[]>>();
const driverOptionsCache = new Map<string, CacheEntry<DriverOption[]>>();
const lapCache = new Map<string, CacheEntry<OpenF1Lap[]>>();
const payloadCache = new Map<string, CacheEntry<TelemetryPayload>>();

function fresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.at < TTL;
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

const traceCache = new Map<string, CacheEntry<LapTrace>>();

async function carTrace(sessionKey: number, lap: OpenF1Lap, driver: OpenF1Driver): Promise<LapTrace | null> {
  const key = `${sessionKey}:${lap.driver_number}:${lap.lap_number}`;
  const cachedTrace = traceCache.get(key);
  if (fresh(cachedTrace)) return cachedTrace.data;

  const start = new Date(lap.date_start).getTime();
  const end = start + ((lap.lap_duration ?? 90) + 4) * 1000;
  const params =
    `/car_data?session_key=${sessionKey}&driver_number=${lap.driver_number}` +
    `&date%3E=${new Date(start).toISOString()}&date%3C=${new Date(end).toISOString()}`;

  // OpenF1 throttles bursts, and a throttled lap is not a missing lap: retry once.
  let samples: OpenF1CarSample[] | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    samples = await of1<OpenF1CarSample[]>(params, 20000);
    if (samples && samples.length >= 20) break;
    samples = null;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (!samples) return null;

  const raw = samples.map((s) => ({
    ts: Date.parse(s.date),
    v: s.speed ?? 0,
    th: s.throttle ?? 0,
    br: s.brake ?? 0,
    g: s.n_gear ?? 0,
    drs: s.drs ?? 0,
  }));
  const trace = traceFrom(lap, driver, downsample(withDistance(raw), 320));
  traceCache.set(key, { at: Date.now(), data: trace });
  return trace;
}

async function recentSessions(): Promise<OpenF1Session[]> {
  const year = new Date().getUTCFullYear();
  let sessions = await of1<OpenF1Session[]>(`/sessions?year=${year}`);
  if (!sessions || sessions.length === 0) {
    sessions = await of1<OpenF1Session[]>(`/sessions?year=${year - 1}`);
  }
  if (!sessions || sessions.length === 0) return [];
  return sessions
    .filter((s) => !s.is_cancelled && Date.parse(s.date_start) < Date.now())
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
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
  const cacheKey = "sessions";
  const cached = sessionOptionsCache.get(cacheKey);
  if (fresh(cached)) return { options: cached.data, live: true };

  const sessions = await recentSessions();
  const picked = sessions
    .filter((s) => ["Race", "Qualifying", "Sprint", "Sprint Qualifying", "Sprint Shootout"].includes(s.session_name))
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
  sessionOptionsCache.set(cacheKey, { at: Date.now(), data: picked });
  return { options: picked, live: true };
}

async function sessionLaps(sessionKey: number): Promise<OpenF1Lap[] | null> {
  const key = String(sessionKey);
  const cached = lapCache.get(key);
  if (fresh(cached)) return cached.data;
  const laps = await of1<OpenF1Lap[]>(`/laps?session_key=${sessionKey}`, 14000, 2);
  if (!laps) return null;
  lapCache.set(key, { at: Date.now(), data: laps });
  return laps;
}

/** Every driver in a session, with the laps they actually set. */
export async function getDriverOptions(
  sessionKey: number,
): Promise<{ options: DriverOption[]; session: SessionOption | null; live: boolean }> {
  const key = String(sessionKey);
  const cached = driverOptionsCache.get(key);
  if (fresh(cached)) {
    const sessions = sessionOptionsCache.get("sessions");
    const session = sessions?.data.find((s) => s.key === sessionKey) ?? null;
    return { options: cached.data, session, live: true };
  }

  const [drivers, laps] = await Promise.all([
    of1<OpenF1Driver[]>(`/drivers?session_key=${sessionKey}`, 12000, 2),
    sessionLaps(sessionKey),
  ]);

  if (!drivers || !laps) {
    return { options: cachedDrivers(), session: cachedSessions()[0], live: false };
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
    return { options: cachedDrivers(), session: cachedSessions()[0], live: false };
  }

  driverOptionsCache.set(key, { at: Date.now(), data: options });
  const sessions = await getSessionOptions();
  return { options, session: sessions.options.find((s) => s.key === sessionKey) ?? null, live: true };
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

/** The pair a visitor asked for, by session + driver + lap. */
export async function getSelectedTelemetry(request: {
  sessionKey: number;
  a: number;
  lapA: number;
  b: number;
  lapB: number;
}): Promise<TelemetryPayload> {
  const { sessionKey, a, lapA, b, lapB } = request;
  const cacheKey = `${sessionKey}:${a}:${lapA}:${b}:${lapB}`;
  const cached = payloadCache.get(cacheKey);
  if (fresh(cached)) return cached.data;

  if (sessionKey === CACHED_TELEMETRY.session.sessionKey) {
    // The bundled pair is the same race; anything else on that session needs the network.
    const cachedMatch =
      CACHED_TELEMETRY.drivers.find((d) => d.number === a && d.lapNumber === lapA) &&
      CACHED_TELEMETRY.drivers.find((d) => d.number === b && d.lapNumber === lapB);
    if (cachedMatch) {
      const payload = fallback("Bundled Interlagos pair — instant, no network needed.");
      payloadCache.set(cacheKey, { at: Date.now(), data: payload });
      return payload;
    }
  }

  const [drivers, laps] = await Promise.all([
    of1<OpenF1Driver[]>(`/drivers?session_key=${sessionKey}`, 12000, 2),
    sessionLaps(sessionKey),
  ]);
  if (!drivers || !laps) {
    throw new Error("OpenF1 did not answer. Try again in a moment.");
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

  const session = await getSessionOptions();
  const meta = session.options.find((s) => s.key === sessionKey);
  const payload: TelemetryPayload = {
    source: "live",
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
  payloadCache.set(cacheKey, { at: Date.now(), data: payload });
  return payload;
}

/** Default view: the two fastest laps of the latest race. */
async function liveTelemetry(): Promise<TelemetryPayload | null> {
  const races = (await recentSessions()).filter((s) => s.session_name === "Race");
  if (races.length === 0) return null;
  const session = races[0];

  const [drivers, laps] = await Promise.all([
    of1<OpenF1Driver[]>(`/drivers?session_key=${session.session_key}`, 12000, 2),
    of1<OpenF1Lap[]>(`/laps?session_key=${session.session_key}`, 14000, 2),
  ]);
  if (!drivers || !laps) return null;
  const driverList = drivers;
  const fastest = pickFastestLaps(laps).slice(0, 2);
  if (fastest.length < 2) return null;

  const traces: LapTrace[] = [];
  for (const lap of fastest) {
    const driver = driverList.find((d) => d.driver_number === lap.driver_number);
    if (!driver) continue;
    const trace = await carTrace(session.session_key, lap, driver);
    if (trace) traces.push(trace);
  }
  if (traces.length < 2) return null;

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
  const cached = payloadCache.get("default");
  if (fresh(cached)) return cached.data;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const live = await liveTelemetry();
      if (live) {
        payloadCache.set("default", { at: Date.now(), data: live });
        return live;
      }
    } catch {
      // retry once before falling back to the cached pair
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return fallback("Live OpenF1 feed unavailable — showing the cached Interlagos 2026 pair.");
}
