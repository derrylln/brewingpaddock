import { NextResponse } from "next/server";
import { getForecastRecord } from "@/lib/forecast-record";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

/**
 * The forecast rerun on the completed rounds, so the strategy calls can be
 * judged against what actually happened. Cached half an hour: it only changes
 * when a race finishes.
 */
export async function GET(request: Request) {
  const gate = await guard(request, "forecast", LIMITS.forecast.limit, LIMITS.forecast.windowMs);
  if (!gate.ok) return gate.response;

  try {
    const record = await getForecastRecord();
    return withGuardHeaders(
      NextResponse.json(record, {
        headers: {
          "Cache-Control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600",
        },
      }),
      gate,
    );
  } catch (error) {
    console.error("[strategy/record] failed", error);
    return NextResponse.json({ error: "The record could not be built." }, { status: 502 });
  }
}
