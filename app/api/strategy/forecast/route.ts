import { NextResponse } from "next/server";
import { getSeasonOverview } from "@/lib/f1";
import { circuitForRace, forecastRace } from "@/lib/strategy-forecast";

export const revalidate = 600;

/** The next race on the calendar, priced plan by plan. */
export async function GET() {
  try {
    const overview = await getSeasonOverview();
    const race = overview.nextRace ?? overview.schedule[overview.schedule.length - 1] ?? null;
    if (!race) {
      return NextResponse.json({ error: "No race on the calendar." }, { status: 404 });
    }

    const forecast = forecastRace(
      circuitForRace({
        raceName: race.raceName,
        circuitId: race.Circuit.circuitId,
        round: Number(race.round),
        date: race.date,
        country: race.Circuit.Location.country,
      }),
    );

    return NextResponse.json(
      { ...forecast, season: overview.season, upcoming: overview.nextRace !== null },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } },
    );
  } catch (error) {
    console.error("[strategy/forecast] failed", error);
    return NextResponse.json({ error: "The forecast could not be built." }, { status: 502 });
  }
}
