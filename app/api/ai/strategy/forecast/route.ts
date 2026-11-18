import { NextResponse } from "next/server";
import { forecastRead } from "@/lib/ai-reads";
import { getNextForecast } from "@/lib/forecast";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The client sends the round it is showing; the server rebuilds (or reuses the
 * cached) forecast before asking the model to read it, so the text can only
 * describe plans the model actually priced.
 */
export async function POST(request: Request) {
  const gate = await guard(request, "ai", LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!gate.ok) return gate.response;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const round = Number.parseInt(String(body.round ?? ""), 10);

    const forecast = await getNextForecast();
    if (Number.isFinite(round) && round !== forecast.race.round) {
      return NextResponse.json({ error: "That round is no longer the forecast." }, { status: 409 });
    }

    const read = await forecastRead(forecast);
    return withGuardHeaders(
      NextResponse.json({ read, call: forecast.call, round: forecast.race.round }),
      gate,
    );
  } catch (error) {
    console.error("[ai/strategy/forecast] failed", error);
    return NextResponse.json({ error: "The desk could not read that forecast." }, { status: 502 });
  }
}
