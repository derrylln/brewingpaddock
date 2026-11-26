import recordedCalls from "@/data/recorded-calls.json";
import { cached } from "@/lib/cache";
import {
  SNAPSHOT,
  getSchedule,
  getSeasonResults,
  raceFinished,
  resolveSeason,
  type RaceResult,
} from "@/lib/f1";
import { W_RECENCY, WEIGHTS } from "@/lib/predict";
import { codeOf, rankFromHistory } from "@/lib/walk-forward";
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
 *
 * A replay is a re-scoring, not a call: it runs today's model on data the
 * archive no longer holds, so it can disagree with the board visitors saw. Only
 * a call written down before the lights — the frozen log, or a board
 * transcribed into `data/recorded-calls.json` — can be a called winner.
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
  /** Places the call covered: 3 when only the board's top three was recorded. */
  predictedSize: number;
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
  /** Rounds with a full top ten to score, the denominator of `top10Rate`. */
  top10Rounds: number;
  /** The next race's frozen ranking, waiting on the flag. */
  locked: SavedPrediction | null;
  note: string;
};

const WINDOW = 8;

type RecordedCall = {
  raceName: string;
  date: string;
  raceWinner?: string;
  shown: string;
  top: Array<{ code: string; name: string; team: string; win: number }>;
};

/** Boards the published page actually showed before a race, by season then round. */
const RECORDED: Record<string, Record<string, RecordedCall>> = (
  recordedCalls as { seasons: Record<string, Record<string, RecordedCall>> }
).seasons;

function classified(results: RaceResult[]): RaceResult[] {
  return results
    .filter((result) => /^\d+$/.test(result.positionText))
    .sort((a, b) => Number(a.position) - Number(b.position));
}

export function getPredictRecord(): Promise<PredictRecord> {
  return cached("predict:record:v2", 30 * 60_000, async () => {
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
      const recorded = RECORDED[String(season)]?.[String(round)];
      const source = frozen || recorded ? "saved" : "replay";
      const predicted = frozen
        ? frozen.ranking.map((entry) => entry.code)
        : recorded
          ? recorded.top.map((entry) => entry.code)
          : rankFromHistory(
              ordered.filter((entry) => entry.round < round),
              target.results,
              WEIGHTS,
              W_RECENCY,
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
        source,
        predicted: predictedTop3,
        actual: podium,
        winner: winner ?? "—",
        // A replay is a re-scoring of today's model, never a pre-race call.
        winnerCalled: source === "saved" && winner !== undefined && predictedTop3[0] === winner,
        winnerInTop3: winner !== undefined && predictedTop3.includes(winner),
        podiumHits: predictedTop3.filter((code) => podium.includes(code)).length,
        top10Hits: predictedTop10.filter((code) => top10.includes(code)).length,
        predictedSize: predicted.length,
      });
    }

    rows.reverse();

    const scored = rows.length;
    const podiumHits = rows.reduce((sum, row) => sum + row.podiumHits, 0);
    // A board captured as a top three only ranks three places, so the top-ten
    // rate is measured across the rounds that actually called a top ten.
    const fullCalls = rows.filter((row) => row.predictedSize >= 10);
    const top10Hits = fullCalls.reduce((sum, row) => sum + row.top10Hits, 0);
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
      top10Rate: fullCalls.length === 0 ? null : top10Hits / (fullCalls.length * 10),
      top10Rounds: fullCalls.length,
      locked,
      note: "Calls written down before the race are scored as they were made and marked saved: a ranking frozen in the log, or a board transcribed from the published page, which covers the top three only. Rounds without one are replayed with the model's five factors on the data available at the time — the rounds before it, plus that race's grid in place of a qualifying session the archive no longer holds — and marked replay. A replay is a re-scoring rather than a call, so it cannot be a called winner. Podium and top-ten hits are measured against the classification.",
    };
  });
}
