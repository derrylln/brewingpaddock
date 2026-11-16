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

async function of1<T>(path: string, timeout = 9000): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

let cache: { at: number; payload: TelemetryPayload } | null = null;
const TTL = 10 * 60 * 1000;

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
    if (!lap.lap_duration || lap.is_pit_out_lap || lap.is_pit_in_lap) continue;
    if (lap.lap_duration < 55 || lap.lap_duration > 200) continue;
    const current = best.get(lap.driver_number);
    if (!current || (current.lap_duration ?? 999) > lap.lap_duration) {
      best.set(lap.driver_number, lap);
    }
  }
  return [...best.values()].sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
}

async function liveTelemetry(): Promise<TelemetryPayload | null> {
  const year = new Date().getUTCFullYear();
  let sessions = await of1<OpenF1Session[]>(`/sessions?year=${year}`);
  if (!sessions || sessions.length === 0) {
    sessions = await of1<OpenF1Session[]>(`/sessions?year=${year - 1}`);
  }
  if (!sessions || sessions.length === 0) return null;

  const races = sessions
    .filter((s) => s.session_name === "Race" && !s.is_cancelled)
    .filter((s) => Date.parse(s.date_start) < Date.now())
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  if (races.length === 0) return null;
  const session = races[0];

  const [drivers, laps] = await Promise.all([
    of1<OpenF1Driver[]>(`/drivers?session_key=${session.session_key}`),
    of1<OpenF1Lap[]>(`/laps?session_key=${session.session_key}`),
  ]);
  if (!drivers || !laps) return null;
  const fastest = pickFastestLaps(laps).slice(0, 2);
  if (fastest.length < 2) return null;

  const traces: LapTrace[] = [];
  for (const lap of fastest) {
    const driver = drivers.find((d) => d.driver_number === lap.driver_number);
    if (!driver) continue;
    const start = new Date(lap.date_start).getTime();
    const end = start + ((lap.lap_duration ?? 90) + 4) * 1000;
    const params =
      `/car_data?session_key=${session.session_key}&driver_number=${lap.driver_number}` +
      `&date%3E=${new Date(start).toISOString()}&date%3C=${new Date(end).toISOString()}`;
    const samples = await of1<OpenF1CarSample[]>(params, 16000);
    if (!samples || samples.length < 20) continue;

    const raw = samples.map((s) => ({
      ts: Date.parse(s.date),
      v: s.speed ?? 0,
      th: s.throttle ?? 0,
      br: s.brake ?? 0,
      g: s.n_gear ?? 0,
      drs: s.drs ?? 0,
    }));
    const points: TelemetryPoint[] = withDistance(raw);
    traces.push({
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
      points: downsample(points, 320),
    });
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
  if (cache && Date.now() - cache.at < TTL) return cache.payload;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const live = await liveTelemetry();
      if (live) {
        cache = { at: Date.now(), payload: live };
        return live;
      }
    } catch {
      // retry once before falling back to the cached pair
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return fallback("Live OpenF1 feed unavailable — showing the cached Interlagos 2026 pair.");
}
