import { cached } from "@/lib/cache";
import {
  SNAPSHOT,
  getSchedule,
  getSeasonResults,
  isFinisher,
  raceFinished,
  resolveSeason,
  type RaceResult,
  type SeasonResults,
} from "@/lib/f1";
import { W_RECENCY, WEIGHTS } from "@/lib/predict";
import { readPredictLog, type SavedPrediction } from "@/lib/pre-race-log";

/**
 * The predictor's track record over the last completed rounds.
 *
 * Two kinds of call are scored:
 *
 * - `saved`: the ranking was frozen in `lib/pre-race-log.ts` before the race,
 *   so a later retune cannot rewrite it.
 * - `replay`: no saved call exists for that round, so the model's weights are
 *   run on the data available at the time — every round before it, with that
 *   race's grid standing in for the latest qualifying session, which the archive
 *   does not keep for old rounds.
 *
 * The live model ranks drivers by simulated win probability. For the record the
 * same five weighted factors are applied to the historic state and ranked
 * directly, so the table measures the model's ordering, not its Monte Carlo
 * noise. Actuals come from the classification: podium and top ten by position.
 */

export type PredictRecordRow = {
  round: number;
  raceName: string;
  date: string;
  source: "saved" | "replay";
  /** Model's top three, best first. */
  predicted: string[];
  /** Actual podium, P1 first. */
  actual: string[];
  winner: string;
  winnerCalled: boolean;
  winnerInTop3: boolean;
  podiumHits: number;
  top10Hits: number;
};

export type PredictRecord = {
  season: number;
  rows: PredictRecordRow[];
  scored: number;
  saved: number;
  replayed: number;
  winnerCalls: number;
  winnerTop3: number;
  /** Share of podium slots (3 per race) the model placed, 0..1. */
  podiumRate: number | null;
  /** Share of top-ten slots (10 per race) the model placed, 0..1. */
  top10Rate: number | null;
  /** The next race's frozen ranking, waiting on the flag. */
  locked: SavedPrediction | null;
  note: string;
};

const WINDOW = 8;

function codeOf(driver: RaceResult["Driver"]): string {
  return driver.code ?? driver.familyName.slice(0, 3).toUpperCase();
}

function stdev(values: number[]): number {
  if (values.length < 2) return 3;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

type Form = { positions: number[]; points: number[]; grids: number[]; dnf: number };

/** The live model's five factors, applied to the state before `target`. */
function rankFromHistory(history: SeasonResults, entrants: RaceResult[]): string[] {
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
        const weight = W_RECENCY[W_RECENCY.length - points5.length + index] ?? 0.2;
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
      // The grid is set before the race, so it stands in for the latest
      // qualifying session on rounds where the archive has no lap times.
      const latestQuali = Math.max(0, (22 - (grid.get(id) ?? 20)) / 21);
      const qualiScore = rollingQuali * 0.6 + latestQuali * 0.4;

      const position = champRank.get(id) ?? fieldSize;
      const champ = 1 - (position - 1) / Math.max(1, fieldSize - 1);
      const consistency = Math.exp(-stdev(last5) / 4.5);

      const team = result.Constructor.constructorId;
      const recentTeamStrength = (recentTeam.get(team) ?? 0) / maxRecentTeam;
      const seasonTeamStrength = (teamPoints.get(team) ?? 0) / leaderTeam;
      const teamStrength = Math.min(1, recentTeamStrength * 0.75 + seasonTeamStrength * 0.25);

      const score =
        WEIGHTS.quali * qualiScore +
        WEIGHTS.form * fullForm +
        WEIGHTS.team * teamStrength +
        WEIGHTS.consistency * consistency +
        WEIGHTS.champ * champ;

      return { code: codeOf(result.Driver), score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((row) => row.code);
}

function classified(results: RaceResult[]): RaceResult[] {
  return results
    .filter((result) => /^\d+$/.test(result.positionText))
    .sort((a, b) => Number(a.position) - Number(b.position));
}

export function getPredictRecord(): Promise<PredictRecord> {
  return cached("predict:record", 30 * 60_000, async () => {
    const season = await resolveSeason();
    const [schedule, log] = await Promise.all([getSchedule(season), readPredictLog(season)]);

    const completed = schedule.filter((race) => raceFinished(race)).slice(-WINDOW);

    const byRound = new Map(
      season === SNAPSHOT.season ? SNAPSHOT.seasonResults.map((entry) => [entry.round, entry]) : [],
    );
    if (!completed.every((race) => (byRound.get(Number(race.round))?.results.length ?? 0) > 0)) {
      for (const entry of await getSeasonResults(season)) byRound.set(entry.round, entry);
    }
    const ordered = [...byRound.values()].sort((a, b) => a.round - b.round);

    const locked =
      Object.values(log.entries)
        .filter((entry) => new Date(entry.start).getTime() > Date.now())
        .sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;

    const rows: PredictRecordRow[] = [];

    for (const race of completed) {
      const round = Number(race.round);
      const target = byRound.get(round);
      if (!target || target.results.length === 0) continue;

      const frozen = log.entries[String(round)];
      const predicted = frozen
        ? frozen.ranking.map((entry) => entry.code)
        : rankFromHistory(
            ordered.filter((entry) => entry.round < round),
            target.results,
          );
      if (predicted.length === 0) continue;

      const podium = classified(target.results)
        .slice(0, 3)
        .map((result) => codeOf(result.Driver));
      const top10 = classified(target.results)
        .slice(0, 10)
        .map((result) => codeOf(result.Driver));
      const predictedTop3 = predicted.slice(0, 3);
      const predictedTop10 = predicted.slice(0, 10);
      const winner = podium[0];

      rows.push({
        round,
        raceName: target.raceName.replace(" Grand Prix", ""),
        date: race.date,
        source: frozen ? "saved" : "replay",
        predicted: predictedTop3,
        actual: podium,
        winner: winner ?? "—",
        winnerCalled: winner !== undefined && predictedTop3[0] === winner,
        winnerInTop3: winner !== undefined && predictedTop3.includes(winner),
        podiumHits: predictedTop3.filter((code) => podium.includes(code)).length,
        top10Hits: predictedTop10.filter((code) => top10.includes(code)).length,
      });
    }

    rows.reverse();

    const scored = rows.length;
    const podiumHits = rows.reduce((sum, row) => sum + row.podiumHits, 0);
    const top10Hits = rows.reduce((sum, row) => sum + row.top10Hits, 0);
    const saved = rows.filter((row) => row.source === "saved").length;

    return {
      season,
      rows,
      scored,
      saved,
      replayed: scored - saved,
      winnerCalls: rows.filter((row) => row.winnerCalled).length,
      winnerTop3: rows.filter((row) => row.winnerInTop3).length,
      podiumRate: scored === 0 ? null : podiumHits / (scored * 3),
      top10Rate: scored === 0 ? null : top10Hits / (scored * 10),
      locked,
      note: "Calls frozen before the race are scored as they were made, and marked saved. Rounds without a frozen ranking are replayed with the model's five factors on the data available at the time — the rounds before it, plus that race's grid in place of a qualifying session the archive no longer holds — and marked replay. Podium and top-ten hits are measured against the classification.",
    };
  });
}
