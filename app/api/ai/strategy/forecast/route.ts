import { NextResponse } from "next/server";
import { forecastRead } from "@/lib/ai-reads";
import { getSeasonOverview } from "@/lib/f1";
import { circuitForRace, forecastRace } from "@/lib/strategy-forecast";

export const dynamic = "force-dynamic";

/**
 * The client sends the round it is showing; the server rebuilds the forecast
 * from the calendar before asking the model to read it.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const round = Number.parseInt(String(body.round ?? ""), 10);

    const overview = await getSeasonOverview();
    const race =
      (Number.isFinite(round) ? overview.schedule.find((r) => Number(r.round) === round) : null) ??
      overview.nextRace ??
      overview.schedule[overview.schedule.length - 1] ??
      null;

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
    const read = await forecastRead(forecast);

    return NextResponse.json({ read, call: forecast.call, round: race.round });
  } catch (error) {
    console.error("[ai/strategy/forecast] failed", error);
    return NextResponse.json({ error: "The desk could not read that forecast." }, { status: 502 });
  }
}
