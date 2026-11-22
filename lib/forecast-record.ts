import { cached } from "@/lib/cache";
import {
  getPitStops,
  getSeasonOverview,
  getSeasonResults,
  isFinisher,
  type PitStop,
} from "@/lib/f1";
import { circuitForRace, forecastRace } from "@/lib/strategy-forecast";

/**
 * Forecast versus actual.
 *
 * There is no stored prediction: nothing was saved before the race, so this
 * replays the current forecast over the completed rounds instead. That is a
 * backtest, not a track record, and the panel says so — tuning the model moves
 * this history too. It is still the only honest way to ask whether the calls
 * beat the field, given there is no database sitting behind the site.
 *
 * "Actual" comes from the official pit-stop log: the winner's stop count, the
 * median stop count of the top ten finishers, and the median lap of their first
 * stop. Predicted is the favourite plan's shape and first pit lap.
 */

export type ForecastRecordRow = {
  round: number;
  raceName: string;
  circuitName: string;
  date: string;
  winner: string;
  winnerTeam: string;
  predicted: {
    label: string;
    stops: number;
    pitLaps: number[];
    probability: number;
  };
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
  stopsHits: number;
  meanPitError: number | null;
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

export function getForecastRecord(): Promise<ForecastRecord> {
  return cached("forecast:record", 30 * 60_000, async () => {
    const overview = await getSeasonOverview();
    const season = overview.season;
    const schedule = new Map(overview.schedule.map((race) => [Number(race.round), race]));
    const results = await getSeasonResults(season);

    const completed = results
      .filter((entry) => entry.results.length > 0 && schedule.has(entry.round))
      .slice(-WINDOW);

    const rows: ForecastRecordRow[] = [];

    for (const entry of completed) {
      const race = schedule.get(entry.round);
      if (!race) continue;

      const forecast = forecastRace(
        circuitForRace({
          raceName: race.raceName,
          circuitId: race.Circuit.circuitId,
          round: Number(race.round),
          date: race.date,
          country: race.Circuit.Location.country,
        }),
      );
      const favourite = forecast.plans[0];
      if (!favourite) continue;

      const pits = await getPitStops(season, entry.round);
      // No pit log means the counts would read as an all-no-stop race, which is
      // worse than leaving the round out.
      if (pits.length === 0) continue;

      const byDriver = new Map<string, PitStop[]>();
      for (const stop of pits) {
        const list = byDriver.get(stop.driverId) ?? [];
        list.push(stop);
        byDriver.set(stop.driverId, list);
      }

      const winnerResult = entry.results[0];
      if (!winnerResult) continue;

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
      const predictedPit = favourite.pitLaps[0] ?? null;

      rows.push({
        round: entry.round,
        raceName: entry.raceName.replace(" Grand Prix", ""),
        circuitName: race.Circuit.circuitName,
        date: race.date,
        winner: codeOf(winnerResult.Driver),
        winnerTeam: winnerResult.Constructor.name,
        predicted: {
          label: favourite.label,
          stops: favourite.stops,
          pitLaps: favourite.pitLaps,
          probability: favourite.probability,
        },
        actual: {
          winnerStops,
          fieldStops,
          firstPitLap,
          finishers: top.length,
        },
        stopsHit: fieldStops !== null && favourite.stops === fieldStops,
        pitDelta: predictedPit !== null && firstPitLap !== null ? firstPitLap - predictedPit : null,
      });
    }

    const deltas = rows
      .map((row) => row.pitDelta)
      .filter((delta): delta is number => delta !== null);

    return {
      season,
      rows: rows.reverse(),
      scored: rows.length,
      stopsHits: rows.filter((row) => row.stopsHit).length,
      meanPitError:
        deltas.length === 0
          ? null
          : Math.round((deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length) * 10) /
            10,
      note: "Rebuilt, not stored: each completed round is rerun through the current forecast, so tuning the model changes this history. Actual stop counts come from the official pit-stop log; the field figure is the median of the top ten finishers.",
    };
  });
}
