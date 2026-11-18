import fixture from "@/data/telemetry-brazil-2026.json";

export type TelemetryPoint = {
  t: number;
  d: number;
  v: number;
  th: number;
  br: number;
  g: number;
  drs: number;
};

export type LapTrace = {
  number: number;
  code: string;
  name: string;
  team: string;
  colour: string;
  lapNumber: number;
  lapTime: number;
  sectors: [number, number, number];
  points: TelemetryPoint[];
};

export type TelemetryPayload = {
  source: "live" | "cached";
  session: {
    sessionKey: number;
    year: number;
    name: string;
    circuit: string;
    country: string;
    date: string;
  };
  drivers: [LapTrace, LapTrace];
  fetchedAt: string;
  note?: string;
};

export type Comparison = {
  grid: number[];
  length: number;
  maxSpeed: number;
  a: { v: number[]; th: number[]; br: number[] };
  b: { v: number[]; th: number[]; br: number[] };
  delta: number[];
  lapDelta: number;
  sectorDelta: [number, number, number];
};

type RawLap = Omit<LapTrace, "sectors"> & {
  sectors?: [number, number, number];
  sector1?: number;
  sector2?: number;
  sector3?: number;
};

const rawFixture = fixture as unknown as {
  session: TelemetryPayload["session"];
  drivers: RawLap[];
};

function normaliseLap(lap: RawLap): LapTrace {
  const sectors: [number, number, number] = lap.sectors ?? [
    lap.sector1 ?? 0,
    lap.sector2 ?? 0,
    lap.sector3 ?? 0,
  ];
  return { ...lap, sectors };
}

/** Cached fallback: a real pair of fastest laps pulled from OpenF1. */
export const CACHED_TELEMETRY: TelemetryPayload = {
  source: "cached",
  session: rawFixture.session,
  drivers: [normaliseLap(rawFixture.drivers[0]), normaliseLap(rawFixture.drivers[1])],
  fetchedAt: new Date().toISOString(),
};

function series(points: TelemetryPoint[], key: "v" | "th" | "br" | "t"): number[] {
  return points.map((p) => p[key]);
}

function sampleAt(dists: number[], values: number[], grid: number[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const x of grid) {
    while (cursor < dists.length - 2 && dists[cursor + 1] < x) cursor += 1;
    const d0 = dists[cursor];
    const d1 = dists[cursor + 1] ?? d0;
    const v0 = values[cursor];
    const v1 = values[cursor + 1] ?? v0;
    const span = d1 - d0;
    const ratio = span > 0 ? (x - d0) / span : 0;
    out.push(v0 + (v1 - v0) * Math.min(1, Math.max(0, ratio)));
  }
  return out;
}

export function alignLaps(a: LapTrace, b: LapTrace, samples = 300): Comparison {
  const distA = a.points.map((p) => p.d);
  const distB = b.points.map((p) => p.d);
  const length = Math.min(distA[distA.length - 1], distB[distB.length - 1]);
  const grid = Array.from({ length: samples }, (_, i) => (i / (samples - 1)) * length);

  const timeA = sampleAt(distA, series(a.points, "t"), grid);
  const timeB = sampleAt(distB, series(b.points, "t"), grid);
  const delta = timeA.map((t, i) => t - timeA[0] - (timeB[i] - timeB[0]));

  const speedA = sampleAt(distA, series(a.points, "v"), grid);
  const speedB = sampleAt(distB, series(b.points, "v"), grid);

  return {
    grid,
    length,
    maxSpeed: Math.max(...speedA, ...speedB),
    a: {
      v: speedA,
      th: sampleAt(distA, series(a.points, "th"), grid),
      br: sampleAt(distA, series(a.points, "br"), grid),
    },
    b: {
      v: speedB,
      th: sampleAt(distB, series(b.points, "th"), grid),
      br: sampleAt(distB, series(b.points, "br"), grid),
    },
    delta,
    lapDelta: a.lapTime - b.lapTime,
    sectorDelta: [
      a.sectors[0] - b.sectors[0],
      a.sectors[1] - b.sectors[1],
      a.sectors[2] - b.sectors[2],
    ],
  };
}

export function downsample(points: TelemetryPoint[], target = 320): TelemetryPoint[] {
  if (points.length <= target) return points;
  const step = Math.ceil(points.length / target);
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function withDistance(raw: Array<Omit<TelemetryPoint, "t" | "d"> & { ts: number }>): TelemetryPoint[] {
  const out: TelemetryPoint[] = [];
  let dist = 0;
  let prevTs: number | null = null;
  let prevSpeed = 0;
  const start = raw[0]?.ts ?? 0;
  for (const point of raw) {
    if (prevTs !== null) {
      const dt = Math.min(1, Math.max(0, (point.ts - prevTs) / 1000));
      dist += ((point.v + prevSpeed) / 2 / 3.6) * dt;
    }
    out.push({
      t: (point.ts - start) / 1000,
      d: dist,
      v: point.v,
      th: point.th,
      br: point.br,
      g: point.g,
      drs: point.drs,
    });
    prevTs = point.ts;
    prevSpeed = point.v;
  }
  return out;
}

export type LapSummary = {
  code: string;
  team: string;
  lapNumber: number;
  lapTime: number;
  maxSpeed: number;
  avgThrottle: number;
  brakeZones: number;
};

export type ComparisonSummary = {
  a: LapSummary;
  b: LapSummary;
  lapDelta: number;
  sectorDelta: [number, number, number];
  /** Where the slower driver loses the most, and where they claw it back. */
  worstZone: { distance: number; value: number; code: string };
  bestZone: { distance: number; value: number; code: string };
  finalDelta: number;
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function brakeZones(brake: number[]): number {
  let zones = 0;
  for (let i = 1; i < brake.length; i += 1) {
    if (brake[i] > 50 && brake[i - 1] <= 50) zones += 1;
  }
  return zones;
}

function summariseLap(lap: LapTrace, comparison: Comparison, side: "a" | "b"): LapSummary {
  return {
    code: lap.code,
    team: lap.team,
    lapNumber: lap.lapNumber,
    lapTime: lap.lapTime,
    maxSpeed: Math.round(Math.max(...comparison[side].v)),
    avgThrottle: Math.round(mean(comparison[side].th)),
    brakeZones: brakeZones(comparison[side].br),
  };
}

/** The handful of facts the AI read is allowed to use, all computed here. */
export function summariseComparison(a: LapTrace, b: LapTrace, comparison: Comparison): ComparisonSummary {
  let worst = 0;
  let best = 0;
  comparison.delta.forEach((value, index) => {
    if (value > comparison.delta[worst]) worst = index;
    if (value < comparison.delta[best]) best = index;
  });

  return {
    a: summariseLap(a, comparison, "a"),
    b: summariseLap(b, comparison, "b"),
    lapDelta: Number((a.lapTime - b.lapTime).toFixed(3)),
    sectorDelta: comparison.sectorDelta.map((value) => Number(value.toFixed(3))) as [
      number,
      number,
      number,
    ],
    worstZone: {
      distance: Math.round(comparison.grid[worst]),
      value: Number(comparison.delta[worst].toFixed(3)),
      code: comparison.delta[worst] > 0 ? b.code : a.code,
    },
    bestZone: {
      distance: Math.round(comparison.grid[best]),
      value: Number(comparison.delta[best].toFixed(3)),
      code: comparison.delta[best] > 0 ? b.code : a.code,
    },
    finalDelta: Number(comparison.delta[comparison.delta.length - 1].toFixed(3)),
  };
}
