import { NextResponse } from "next/server";
import { getForecastRecord } from "@/lib/forecast-record";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

/**
 * The forecast versus the pit log. Frozen calls are read from the forecast log;
 * older rounds are replayed. Cached half an hour, and the build itself now reads
 * the bundled snapshot and fan-outs the live pit logs instead of walking them
 * one at a time, so the first visitor after a deploy does not wait on eight
 * sequential upstream calls.
 */
export async function GET(request: Request) {
  const gate = await guard(request, "forecast", LIMITS.forecast.limit, LIMITS.forecast.windowMs);
  if (!gate.ok) return gate.response;

  try {
    const record = await getForecastRecord();
    return withGuardHeaders(
      NextResponse.json(record, {
        headers: {
          "Cache-Control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=86400",
        },
      }),
      gate,
    );
  } catch (error) {
    console.error("[strategy/record] failed", error);
    return NextResponse.json({ error: "The record could not be built." }, { status: 502 });
  }
}
