import { cached } from "@/lib/cache";
import { readForecastLog, type SavedForecast } from "@/lib/pre-race-log";
import {
  SNAPSHOT,
  fetchPitStopsDirect,
  getPitStops,
  getRaceResults,
  getSchedule,
  getSeasonResults,
  isFinisher,
  raceFinished,
  resolveSeason,
  type PitStop,
  type Race,
} from "@/lib/f1";
import { circuitForRace, forecastRace } from "@/lib/strategy-forecast";

/**
 * Forecast versus actual.
 *
 * Rounds that have a frozen entry in `lib/pre-race-log.ts` are scored against
 * the call that was saved before the race, so retuning the model afterwards
 * cannot rewrite the record. Rounds from before the log existed — and any round
 * nobody visited before the lights went out — are replayed with the current
 * model and labelled as such. The panel says which is which.
 *
 * "Actual" comes from the official pit-stop log: the winner's stop count, the
 * median stop count of the top ten finishers, and the median lap of their first
 * stop. Predicted is the frozen (or replayed) favourite's shape and first pit lap.
 *
 * The builder is kept cheap because the record is opened cold far more often
 * than it changes (once a race): the bundled snapshot answers for rounds it
 * already covers, the live season results are only fetched when it does not, and
 * the stored log is read alongside the schedule instead of after it.
 */

export type PredictedCall = {
  label: string;
  stops: number;
  pitLaps: number[];
  probability: number;
  source: "saved" | "replay";
  savedAt: string | null;
};

export type ForecastRecordRow = {
  round: number;
  raceName: string;
  circuitName: string;
  date: string;
  winner: string;
  winnerTeam: string;
  predicted: PredictedCall;
  actual: {
    winnerStops: number;
    fieldStops: number | null;
    firstPitLap: number | null;
    finishers: number;
  };
  stopsHit: boolean;
  pitDelta: number | null;
};

export type ForecastRecord = {
  season: number;
  rows: ForecastRecordRow[];
  scored: number;
  saved: number;
  replayed: number;
  stopsHits: number;
  meanPitError: number | null;
  /** The next race's frozen call, waiting on the flag. */
  locked: SavedForecast | null;
  note: string;
};

/** Recent rounds only: enough to see a pattern, cheap enough to rebuild. */
const WINDOW = 8;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function codeOf(name: { code?: string; familyName: string }): string {
  return name.code ?? name.familyName.slice(0, 3).toUpperCase();
}

function snapshotPits(season: number, round: number): PitStop[] {
  if (season !== SNAPSHOT.season) return [];
  return SNAPSHOT.races[String(round)]?.pits ?? [];
}

/** The current model's call, cached for the afternoon: it is only used to fill gaps. */
function replayCall(season: number, race: Race): Promise<PredictedCall | null> {
  return cached(
    `forecast:round:v3:${season}:${race.round}:${race.date}`,
    6 * 60 * 60_000,
    async (): Promise<PredictedCall | null> => {
      const forecast = forecastRace(
        circuitForRace({
          raceName: race.raceName,
          circuitId: race.Circuit.circuitId,
          round: Number(race.round),
          date: race.date,
          time: race.time,
          country: race.Circuit.Location.country,
        }),
      );
      const favourite = forecast.plans[0];
      if (!favourite) return null;
      return {
        label: favourite.label,
        stops: favourite.stops,
        pitLaps: favourite.pitLaps,
        probability: favourite.probability,
        source: "replay",
        savedAt: null,
      };
    },
  );
}

export function getForecastRecord(): Promise<ForecastRecord> {
  return cached("forecast:record:v3", 30 * 60_000, async () => {
    const season = await resolveSeason();
    const [schedule, log] = await Promise.all([getSchedule(season), readForecastLog(season)]);

    // Completion is the scheduled start plus a race window, not the calendar
    // date: a race that has already run still counts on its own date.
    const completed = schedule.filter((race) => raceFinished(race)).slice(-WINDOW);

    // The snapshot already carries every result and pit log it covers, so trust it
    // for those rounds and go live only for rounds that happened since.
    const results = new Map(
      season === SNAPSHOT.season ? SNAPSHOT.seasonResults.map((entry) => [entry.round, entry]) : [],
    );
    const missing = completed.filter(
      (race) => (results.get(Number(race.round))?.results.length ?? 0) === 0,
    );
    // A single new round does not justify paging the whole season: that is five
    // requests, and one 429 used to leave the newest round missing entirely.
    if (missing.length > 3) {
      for (const entry of await getSeasonResults(season)) results.set(entry.round, entry);
    }
    // Anything still absent — a short page, a cooldown — is asked for on its own.
    // A round the panel is about to score cannot be dropped silently.
    for (const race of missing) {
      const round = Number(race.round);
      if ((results.get(round)?.results.length ?? 0) > 0) continue;
      const live = await getRaceResults(season, round);
      if (live.length > 0) {
        results.set(round, { round, raceName: race.raceName, results: live });
      }
    }

    // Pit logs, in parallel, and only over the wire where the snapshot has none.
    const pitsByRound = new Map(
      await Promise.all(
        completed.map(async (race): Promise<[number, PitStop[]]> => {
          const round = Number(race.round);
          const local = snapshotPits(season, round);
          if (local.length > 0) return [round, local];
          const live = await getPitStops(season, round);
          return [round, live.length > 0 ? live : await fetchPitStopsDirect(season, round)];
        }),
      ),
    );

    const locked =
      Object.values(log.entries)
        .filter((entry) => new Date(entry.start).getTime() > Date.now())
        .sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;

    const rows = await Promise.all(
      completed.map(async (race): Promise<ForecastRecordRow | null> => {
        const round = Number(race.round);
        const entry = results.get(round);
        const pits = pitsByRound.get(round) ?? [];
        // No pit log means the counts would read as an all-no-stop race, which is
        // worse than leaving the round out.
        if (!entry || entry.results.length === 0 || pits.length === 0) return null;

        const frozen = log.entries[String(round)];
        const predicted: PredictedCall | null = frozen
          ? { ...frozen.favourite, source: "saved", savedAt: frozen.savedAt }
          : await replayCall(season, race);
        if (!predicted) return null;

        const byDriver = new Map<string, PitStop[]>();
        for (const stop of pits) {
          const list = byDriver.get(stop.driverId) ?? [];
          list.push(stop);
          byDriver.set(stop.driverId, list);
        }

        const winnerResult = entry.results[0];
        if (!winnerResult) return null;

        const top = entry.results.filter((result) => isFinisher(result.status)).slice(0, 10);
        const stopCounts = top.map((result) => (byDriver.get(result.Driver.driverId) ?? []).length);
        const firstLaps = top
          .map((result) => {
            const stops = byDriver.get(result.Driver.driverId) ?? [];
            if (stops.length === 0) return null;
            return Math.min(...stops.map((stop) => Number(stop.lap) || Number.POSITIVE_INFINITY));
          })
          .filter((lap): lap is number => lap !== null && Number.isFinite(lap));

        const winnerStops = (byDriver.get(winnerResult.Driver.driverId) ?? []).length;
        const fieldStops = median(stopCounts);
        const firstPitLap = median(firstLaps);
        const predictedPit = predicted.pitLaps[0] ?? null;

        return {
          round,
          raceName: entry.raceName.replace(" Grand Prix", ""),
          circuitName: race.Circuit.circuitName,
          date: race.date,
          winner: codeOf(winnerResult.Driver),
          winnerTeam: winnerResult.Constructor.name,
          predicted,
          actual: {
            winnerStops,
            fieldStops,
            firstPitLap,
            finishers: top.length,
          },
          stopsHit: fieldStops !== null && predicted.stops === fieldStops,
          pitDelta:
            predictedPit !== null && firstPitLap !== null ? firstPitLap - predictedPit : null,
        };
      }),
    );

    const scoredRows = rows
      .filter((row): row is ForecastRecordRow => row !== null)
      .sort((a, b) => b.round - a.round);

    const deltas = scoredRows
      .map((row) => row.pitDelta)
      .filter((delta): delta is number => delta !== null);
    const saved = scoredRows.filter((row) => row.predicted.source === "saved").length;

    return {
      season,
      rows: scoredRows,
      scored: scoredRows.length,
      saved,
      replayed: scoredRows.length - saved,
      stopsHits: scoredRows.filter((row) => row.stopsHit).length,
      meanPitError:
        deltas.length === 0
          ? null
          : Math.round((deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length) * 10) /
            10,
      locked,
      note: "Rounds forecast before the race are frozen: the call saved that week stands even after the model is retuned, and is marked saved. Rounds from before the log existed — or where nobody opened the forecast before the flag — are rerun with today's model and marked replay. Actual stop counts come from the official pit-stop log; the field figure is the median of the top ten finishers.",
    };
  });
}
