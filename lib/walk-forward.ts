import { isFinisher, type RaceResult, type SeasonResults } from "@/lib/f1";
import { LATEST_QUALI_WEIGHT } from "@/lib/model-weights";

/**
 * Walk-forward scoring.
 *
 * The predictor's five factors, applied to the state that existed *before* a
 * given round. Scoring this way is what lets a race be compared with the call
 * that preceded it without the result leaking into its own inputs — the
 * predictor's sanity check and the track record both rank through here.
 *
 * The grid stands in for the latest qualifying session: it is set before the
 * race and the archive does not keep old qualifying tabs.
 */

export type DriverWeights = {
  quali: number;
  form: number;
  team: number;
  consistency: number;
  champ: number;
};

/** Recency weights, oldest round first. */
export type RecencyWeights = number[];

export function codeOf(driver: RaceResult["Driver"]): string {
  return driver.code ?? driver.familyName.slice(0, 3).toUpperCase();
}

function stdev(values: number[]): number {
  if (values.length < 2) return 3;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

type Form = { positions: number[]; points: number[]; grids: number[]; dnf: number };

export type ScoredDriver = { code: string; score: number; grid: number };

export type HistoryOptions = {
  /** The target round's fresh-session score per driver, when it is available. */
  latestQuali?: Map<string, number>;
  /** Override the blend, so alternatives can be replayed against the same rounds. */
  latestWeight?: number;
};

/** Rank `entrants` (the target race's entry list, whose grids are already set)
 *  using only the rounds in `history`, which must all precede the target. */
export function rankFromHistory(
  history: SeasonResults,
  entrants: RaceResult[],
  weights: DriverWeights,
  recency: RecencyWeights,
  options: HistoryOptions = {},
): string[] {
  return scoreFromHistory(history, entrants, weights, recency, options).map((row) => row.code);
}

/** The same five-factor score, keeping the numbers so callers can rank on them. */
export function scoreFromHistory(
  history: SeasonResults,
  entrants: RaceResult[],
  weights: DriverWeights,
  recency: RecencyWeights,
  options: HistoryOptions = {},
): ScoredDriver[] {
  const latestWeight = options.latestWeight ?? LATEST_QUALI_WEIGHT;
  const form = new Map<string, Form>();
  const driverPoints = new Map<string, number>();
  const teamPoints = new Map<string, number>();

  for (const round of history) {
    for (const result of round.results) {
      const id = result.Driver.driverId;
      const bucket = form.get(id) ?? { positions: [], points: [], grids: [], dnf: 0 };
      const finished = /^\d+$/.test(result.positionText);
      bucket.positions.push(finished ? Number(result.position) : 21);
      bucket.points.push(Number(result.points) || 0);
      bucket.grids.push(Number(result.grid) || 20);
      if (!isFinisher(result.status)) bucket.dnf += 1;
      form.set(id, bucket);

      driverPoints.set(id, (driverPoints.get(id) ?? 0) + (Number(result.points) || 0));
      const team = result.Constructor.constructorId;
      teamPoints.set(team, (teamPoints.get(team) ?? 0) + (Number(result.points) || 0));
    }
  }

  const recentTeam = new Map<string, number>();
  for (const round of history.slice(-5)) {
    for (const result of round.results) {
      const team = result.Constructor.constructorId;
      recentTeam.set(team, (recentTeam.get(team) ?? 0) + (Number(result.points) || 0));
    }
  }

  const order = [...driverPoints.entries()].sort((a, b) => b[1] - a[1]);
  const champRank = new Map(order.map(([id], index) => [id, index + 1]));
  const fieldSize = Math.max(2, order.length);
  const leaderTeam = Math.max(1, ...teamPoints.values());
  const maxRecentTeam = Math.max(1, ...recentTeam.values());
  const grid = new Map(
    entrants.map((result) => [result.Driver.driverId, Number(result.grid) || 20]),
  );

  const scored = entrants
    .map((result) => {
      const id = result.Driver.driverId;
      const record = form.get(id);
      const last5 = record ? record.positions.slice(-5) : [10];
      const points5 = record ? record.points.slice(-5) : [0];
      const grids5 = record ? record.grids.slice(-5) : [10];

      let weightedPoints = 0;
      let weightedFinish = 0;
      let weightedGrid = 0;
      let weightSum = 0;
      points5.forEach((points, index) => {
        const weight = recency[recency.length - points5.length + index] ?? 0.2;
        weightedPoints += points * weight;
        weightedFinish += last5[index] * weight;
        weightedGrid += grids5[index] * weight;
        weightSum += weight;
      });
      weightedPoints /= weightSum;
      weightedFinish /= weightSum;
      weightedGrid /= weightSum;

      const formScore = Math.min(1, weightedPoints / 25);
      const finishScore = Math.min(1, Math.max(0, (21 - weightedFinish) / 20));
      const pRecent =
        points5.slice(-2).reduce((a, b) => a + b, 0) / Math.max(1, points5.slice(-2).length);
      const pEarlier =
        points5.slice(0, -2).reduce((a, b) => a + b, 0) /
        Math.max(1, points5.slice(0, -2).length);
      const momentum = Math.min(1, Math.max(0, 0.5 + (pRecent - pEarlier) / 25));
      const fullForm = formScore * 0.55 + finishScore * 0.3 + momentum * 0.15;

      const rollingQuali = Math.min(1, Math.max(0, (21 - weightedGrid) / 20));
      // The session's own scores when the caller has them; otherwise the grid,
      // which is set before the race and is the same signal without the laps.
      const latestQuali =
        options.latestQuali?.get(id) ?? Math.max(0, (22 - (grid.get(id) ?? 20)) / 21);
      const qualiScore = rollingQuali * (1 - latestWeight) + latestQuali * latestWeight;

      const position = champRank.get(id) ?? fieldSize;
      const champ = 1 - (position - 1) / Math.max(1, fieldSize - 1);
      const consistency = Math.exp(-stdev(last5) / 4.5);

      const team = result.Constructor.constructorId;
      const recentTeamStrength = (recentTeam.get(team) ?? 0) / maxRecentTeam;
      const seasonTeamStrength = (teamPoints.get(team) ?? 0) / leaderTeam;
      const teamStrength = Math.min(1, recentTeamStrength * 0.75 + seasonTeamStrength * 0.25);

      const score =
        weights.quali * qualiScore +
        weights.form * fullForm +
        weights.team * teamStrength +
        weights.consistency * consistency +
        weights.champ * champ;

      return { code: codeOf(result.Driver), score, grid: grid.get(id) ?? 20 };
    })
    .sort((a, b) => b.score - a.score);

  return scored;
}
