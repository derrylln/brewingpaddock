import { NextResponse } from "next/server";
import { getNextForecast } from "@/lib/forecast";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

/**
 * The next race on the calendar, priced plan by plan.
 *
 * The forecast is deterministic, so it is cached per round for ten minutes
 * (memory + Workers Cache API) instead of being recomputed for every visitor,
 * and each visitor is limited to 20 calls a minute.
 */
export async function GET(request: Request) {
  const gate = await guard(request, "forecast", LIMITS.forecast.limit, LIMITS.forecast.windowMs);
  if (!gate.ok) return gate.response;

  try {
    const forecast = await getNextForecast();
    return withGuardHeaders(
      NextResponse.json(forecast, {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=3600",
        },
      }),
      gate,
    );
  } catch (error) {
    console.error("[strategy/forecast] failed", error);
    return NextResponse.json({ error: "The forecast could not be built." }, { status: 502 });
  }
}
