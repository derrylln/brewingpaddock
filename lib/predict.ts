import {
  getConstructorStandings,
  getQualifying,
  getSeasonOverview,
  getSeasonResults,
  isFinisher,
  raceStart,
  type Race,
} from "@/lib/f1";
import { LATEST_QUALI_WEIGHT, W_RECENCY, WEIGHTS } from "@/lib/model-weights";
import type { QualifyingResult } from "@/lib/f1";
import { teamColour, teamName } from "@/lib/teams";
import { codeOf, rankFromHistory } from "@/lib/walk-forward";

export { LATEST_QUALI_WEIGHT, W_RECENCY, WEIGHTS };

export type Factor = { key: string; label: string; value: number };

export type PredictionRow = {
  code: string;
  name: string;
  team: string;
  /** Stable constructor id, so other modules can match a driver to their team. */
  teamId: string;
  colour: string;
  score: number;
  win: number;
  podium: number;
  points: number;
  dnfRisk: number;
  factors: Factor[];
};

export type Backtest = {
  raceName: string;
  predicted: string[];
  actual: string[];
  hits: number;
  /** Rounds of history the ranking was built on — everything before the target. */
  rounds: number;
};

export type Prediction = {
  season: number;
  race: {
    round: number;
    name: string;
    circuit: string;
    country: string;
    date: string;
    /** Scheduled start, used to freeze the call before the lights go out. */
    time?: string;
    /** Scheduled qualifying start, so the board knows when its grid input is due. */
    qualiAt?: string;
  };
  rows: PredictionRow[];
  sims: number;
  backtest: Backtest | null;
  method: string[];
  dataPoints: number;
  /** Which qualifying session fed the pace factor, so the board can say what it used. */
  weekend: {
    quali: "this-weekend" | "previous-round" | "none";
  };
};

function parseLap(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The fresh session's score per driver: half stage-relative lap delta, half grid
 * position. Stage-relative so Q1 track evolution is never penalised against dry
 * Q3 rubber. Exported so the replay scores an archived session exactly as the
 * live board scores the one in front of it.
 */
export function qualifyingSessionScores(quali: QualifyingResult[]): Map<string, number> {
  const best = (stage: "Q1" | "Q2" | "Q3") =>
    Math.min(...quali.map((row) => parseLap(row[stage])).filter((v): v is number => v !== null));
  const bestQ3 = best("Q3");
  const bestQ2 = best("Q2");
  const bestQ1 = best("Q1");

  const scores = new Map<string, number>();
  for (const row of quali) {
    const pos = Number(row.position) || 20;
    const posScore = Math.max(0, (22 - pos) / 21);
    let delta = 1.4;
    if (row.Q3) {
      const lap = parseLap(row.Q3);
      if (lap && Number.isFinite(bestQ3)) delta = lap - bestQ3;
    } else if (row.Q2) {
      const lap = parseLap(row.Q2);
      if (lap && Number.isFinite(bestQ2)) delta = 0.4 + (lap - bestQ2);
    } else if (row.Q1) {
      const lap = parseLap(row.Q1);
      if (lap && Number.isFinite(bestQ1)) delta = 0.8 + (lap - bestQ1);
    }
    const deltaScore = Math.exp(-delta / 1.1);
    scores.set(row.Driver.driverId, deltaScore * 0.5 + posScore * 0.5);
  }
  return scores;
}

function gumbel(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  return -Math.log(-Math.log(u));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stdev(values: number[]): number {
  if (values.length < 2) return 3;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * True once this weekend's qualifying has landed upstream. A board built before
 * the session is stale the moment the grid is set, so callers holding one ask
 * this before serving it again.
 */
export async function weekendQualiReady(prediction: Prediction): Promise<boolean> {
  if (prediction.weekend.quali === "this-weekend") return false;
  if (!prediction.race.round) return false;
  const quali = await getQualifying(prediction.season, prediction.race.round);
  return quali.length > 0;
}

/** Build a score in 0..1 for every driver, then simulate the race 4,000 times. */
export async function buildPrediction(): Promise<Prediction> {
  const overview = await getSeasonOverview();
  const season = overview.season;
  const race: Race | null = overview.nextRace ?? overview.lastRace;

  const [seasonResults, constructors, targetQuali] = await Promise.all([
    getSeasonResults(season),
    getConstructorStandings(season),
    race ? getQualifying(season, race.round) : Promise.resolve([]),
  ]);

  // This weekend's qualifying beats last round's once it has run; the previous
  // round stays the fallback for a board loaded before Saturday.
  const previousQuali =
    overview.lastRace && race && overview.lastRace.round !== race.round
      ? await getQualifying(season, overview.lastRace.round)
      : [];
  const qualiFromThisWeekend = targetQuali.length > 0;
  const quali = qualiFromThisWeekend ? targetQuali : previousQuali;
  const qualiSource: Prediction["weekend"]["quali"] = qualiFromThisWeekend
    ? "this-weekend"
    : quali.length > 0
      ? "previous-round"
      : "none";

  // The standings carry everyone who started a race this season — stand-ins and
  // one-off replacements included — so a 22-car grid was being modelled as 25
  // cars. The last completed round's classification is the surest entry list
  // available here, and the board should only spend probability on cars that are
  // actually entered this weekend.
  const lastRound = seasonResults.at(-1);
  const entered = lastRound
    ? new Set(lastRound.results.map((result) => result.Driver.driverId))
    : null;
  const standings =
    entered && entered.size >= 16
      ? overview.standings.filter((entry) => entered.has(entry.driver.driverId))
      : overview.standings;
  const leaderTeamPoints = Math.max(1, constructors[0]?.points ?? 1);
  const teamPoints = new Map(constructors.map((c) => [c.constructor.constructorId, c.points]));

  // Rolling constructor pace over the last 5 races to reward in-season development
  const teamRecent = new Map<string, number>();
  const recentRounds = seasonResults.slice(-5);
  for (const round of recentRounds) {
    for (const r of round.results) {
      const cId = r.Constructor.constructorId;
      teamRecent.set(cId, (teamRecent.get(cId) ?? 0) + (Number(r.points) || 0));
    }
  }
  const maxRecentTeam = Math.max(1, ...teamRecent.values());

  const latestQualiMap = qualifyingSessionScores(quali);

  const form = new Map<string, { positions: number[]; points: number[]; grids: number[]; dnf: number }>();
  for (const round of seasonResults.slice().sort((a, b) => a.round - b.round)) {
    for (const result of round.results) {
      const id = result.Driver.driverId;
      if (!form.has(id)) form.set(id, { positions: [], points: [], grids: [], dnf: 0 });
      const bucket = form.get(id)!;
      const finished = /^\d+$/.test(result.positionText);
      bucket.positions.push(finished ? Number(result.position) : 21);
      bucket.points.push(Number(result.points) || 0);
      bucket.grids.push(Number(result.grid) || 20);
      if (!isFinisher(result.status)) bucket.dnf += 1;
    }
  }

  const rows: PredictionRow[] = standings.map((entry) => {
    const driver = entry.driver;
    const record = form.get(driver.driverId);
    const last5 = record ? record.positions.slice(-5) : [10];
    const points5 = record ? record.points.slice(-5) : [0];
    const grids5 = record ? record.grids.slice(-5) : [10];
    const dnfRate = record && record.positions.length > 0 ? record.dnf / record.positions.length : 0.08;

    // Recency-weighted points, finishes and starting grids
    let weightedPoints = 0;
    let weightedFinish = 0;
    let weightedGrid = 0;
    let wSum = 0;
    points5.forEach((pt, i) => {
      const w = W_RECENCY[W_RECENCY.length - points5.length + i] ?? 0.2;
      weightedPoints += pt * w;
      weightedFinish += last5[i] * w;
      weightedGrid += grids5[i] * w;
      wSum += w;
    });
    weightedPoints /= wSum;
    weightedFinish /= wSum;
    weightedGrid /= wSum;

    const formScore = Math.min(1, weightedPoints / 25);
    const finishScore = Math.min(1, Math.max(0, (21 - weightedFinish) / 20));

    // Momentum / trajectory: are the most recent 2 rounds outperforming earlier rounds?
    const pRecent =
      points5.slice(-2).reduce((a, b) => a + b, 0) / Math.max(1, points5.slice(-2).length);
    const pEarlier =
      points5.slice(0, -2).reduce((a, b) => a + b, 0) / Math.max(1, points5.slice(0, -2).length);
    const momentum = Math.min(1, Math.max(0, 0.5 + (pRecent - pEarlier) / 25));

    const fullForm = formScore * 0.55 + finishScore * 0.3 + momentum * 0.15;

    const code = driver.code ?? driver.familyName.slice(0, 3).toUpperCase();

    // Qualifying pace: a rolling grid average plus the latest session available.
    const rollingQuali = Math.min(1, Math.max(0, (21 - weightedGrid) / 20));
    const latestQuali = latestQualiMap.get(driver.driverId) ?? rollingQuali;
    const qualiScore =
      rollingQuali * (1 - LATEST_QUALI_WEIGHT) + latestQuali * LATEST_QUALI_WEIGHT;

    const champ = 1 - (entry.position - 1) / Math.max(1, standings.length - 1);
    const consistency = Math.exp(-stdev(last5) / 4.5);

    // Blended team strength: 75% recent pace (upgrades) + 25% full-season baseline
    const recentTeamStrength = (teamRecent.get(entry.constructor.constructorId) ?? 0) / maxRecentTeam;
    const seasonTeamStrength = (teamPoints.get(entry.constructor.constructorId) ?? 0) / leaderTeamPoints;
    const teamStrength = Math.min(1, recentTeamStrength * 0.75 + seasonTeamStrength * 0.25);

    const score =
      WEIGHTS.quali * qualiScore +
      WEIGHTS.form * fullForm +
      WEIGHTS.team * teamStrength +
      WEIGHTS.consistency * consistency +
      WEIGHTS.champ * champ;

    return {
      code,
      name: `${driver.givenName} ${driver.familyName}`,
      team: teamName(entry.constructor.constructorId, entry.constructor.name),
      teamId: entry.constructor.constructorId,
      colour: teamColour(entry.constructor.constructorId),
      score,
      win: 0,
      podium: 0,
      points: 0,
      dnfRisk: Math.min(0.28, 0.03 + dnfRate * 0.45),
      factors: [
        { key: "quali", label: "Qualifying pace", value: qualiScore },
        { key: "form", label: "Form & momentum", value: fullForm },
        { key: "team", label: "Team pace", value: teamStrength },
        { key: "consistency", label: "Consistency", value: consistency },
        { key: "champ", label: "Championship", value: champ },
      ],
    };
  });

  const sims = 4000;
  const rand = mulberry32(2026);
  const counts = rows.map(() => ({ win: 0, podium: 0, points: 0 }));

  for (let sim = 0; sim < sims; sim += 1) {
    const order = rows.map((row, index) => ({
      index,
      perf: row.score * 5 + gumbel(rand) * 0.9,
      dnf: rand() < row.dnfRisk ? 1 : 0,
    }));
    order.sort((a, b) => a.dnf - b.dnf || b.perf - a.perf);
    order.forEach((entry, position) => {
      if (entry.dnf) return;
      if (position === 0) counts[entry.index].win += 1;
      if (position < 3) counts[entry.index].podium += 1;
      if (position < 10) counts[entry.index].points += 1;
    });
  }

  rows.forEach((row, index) => {
    row.win = counts[index].win / sims;
    row.podium = counts[index].podium / sims;
    row.points = counts[index].points / sims;
  });
  rows.sort((a, b) => b.win - a.win || b.score - a.score);

  // The sanity check walks forward: the field is ranked on the rounds *before*
  // the target, with that race's grid standing in for qualifying, so the result
  // cannot leak into its own inputs.
  let backtest: Backtest | null = null;
  if (overview.lastRace) {
    const targetRound = Number(overview.lastRace.round);
    const target = seasonResults.find((round) => round.round === targetRound);
    const history = seasonResults
      .filter((round) => round.round < targetRound)
      .sort((a, b) => a.round - b.round);
    if (target && target.results.length > 0 && history.length > 0) {
      const predicted = rankFromHistory(history, target.results, WEIGHTS, W_RECENCY).slice(0, 3);
      const actual = target.results
        .filter((result) => /^\d+$/.test(result.positionText))
        .sort((a, b) => Number(a.position) - Number(b.position))
        .slice(0, 3)
        .map((result) => codeOf(result.Driver));
      backtest = {
        raceName: target.raceName,
        predicted,
        actual,
        hits: predicted.filter((code) => actual.includes(code)).length,
        rounds: history.length,
      };
    }
  }

  const dataPoints = seasonResults.reduce((sum, round) => sum + round.results.length, 0);

  return {
    season,
    race: {
      round: race ? Number(race.round) : 0,
      name: race?.raceName ?? "Next Grand Prix",
      circuit: race?.Circuit.circuitName ?? "—",
      country: race?.Circuit.Location.country ?? "—",
      date: race?.date ?? "",
      time: race?.time,
      qualiAt:
        race?.Qualifying?.date && race.Qualifying.time
          ? raceStart(race.Qualifying).toISOString()
          : undefined,
    },
    rows,
    sims,
    backtest,
    dataPoints,
    weekend: {
      quali: qualiSource,
    },
    method: [
      `Scored ${rows.length} drivers across five weighted factors.`,
      `Qualifying pace and recency-weighted form carry ${Math.round((WEIGHTS.quali + WEIGHTS.form) * 100)}% of the model.`,
      `Pace input: ${
        qualiSource === "this-weekend"
          ? "this weekend's qualifying"
          : qualiSource === "previous-round"
            ? "the last completed round's qualifying, because this weekend's has not run"
            : "rolling grids only, with no qualifying session available"
      }.`,
      `Simulated ${sims.toLocaleString("en-GB")} seeded races with Gumbel noise and per-driver DNF risk.`,
      "No finishing position is ever guaranteed — probabilities, not predictions of fact.",
    ],
  };
}
