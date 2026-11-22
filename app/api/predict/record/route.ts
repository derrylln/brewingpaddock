import { NextResponse } from "next/server";
import { getPredictRecord } from "@/lib/predict-record";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

/**
 * The predictor's accuracy across the completed rounds: frozen rankings where
 * they exist, replays where they do not. Cached half an hour, because it only
 * changes when a race finishes.
 */
export async function GET(request: Request) {
  const gate = await guard(request, "forecast", LIMITS.forecast.limit, LIMITS.forecast.windowMs);
  if (!gate.ok) return gate.response;

  try {
    const record = await getPredictRecord();
    return withGuardHeaders(
      NextResponse.json(record, {
        headers: {
          "Cache-Control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=86400",
        },
      }),
      gate,
    );
  } catch (error) {
    console.error("[predict/record] failed", error);
    return NextResponse.json({ error: "The record could not be built." }, { status: 502 });
  }
}
