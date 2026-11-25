import { cached } from "@/lib/cache";
import { saveForecast } from "@/lib/pre-race-log";
import { getSeasonOverview } from "@/lib/f1";
import { circuitForRace, forecastRace } from "@/lib/strategy-forecast";

/**
 * The next race forecast, built once per round and shared by the page route and
 * the AI read route — both would otherwise recompute the whole plan grid.
 */
export async function getNextForecast() {
  return cached(
    "forecast:next:v4",
    10 * 60_000,
    async () => {
      const overview = await getSeasonOverview();
      const race = overview.nextRace ?? overview.schedule[overview.schedule.length - 1] ?? null;
      if (!race) throw new Error("No race on the calendar.");

      const priced = forecastRace(
        circuitForRace({
          raceName: race.raceName,
          circuitId: race.Circuit.circuitId,
          round: Number(race.round),
          date: race.date,
          time: race.time,
          country: race.Circuit.Location.country,
        }),
      );

      // Freeze the call before the race. A failure here must not cost the
      // visitor the forecast, so saveForecast keeps its own errors quiet.
      await saveForecast(overview.season, priced).catch((error) => {
        console.warn("[forecast] could not freeze the call", error);
        return null;
      });

      return { ...priced, season: overview.season, upcoming: overview.nextRace !== null };
    },
  );
}
