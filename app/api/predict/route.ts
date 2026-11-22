import { NextResponse } from "next/server";
import { predictionRead } from "@/lib/ai-reads";
import type { AiRead } from "@/lib/ai";
import { buildPrediction, type Prediction } from "@/lib/predict";
import { savePrediction } from "@/lib/pre-race-log";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Payload = Prediction & { read: AiRead };

// The forecast rebuilds the season archive and runs 4,000 simulations, and its
// written read costs money, so both are held per isolate for ten minutes.
const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; payload: Payload } | null = null;

export async function GET(request: Request) {
  const gate = await guard(request, "ai", LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!gate.ok) return gate.response;
  const hourly = await guard(request, "ai-hour", LIMITS.aiHourly.limit, LIMITS.aiHourly.windowMs);
  if (!hourly.ok) return hourly.response;

  if (cached && Date.now() - cached.at < TTL_MS) {
    return withGuardHeaders(NextResponse.json(cached.payload), gate);
  }

  try {
    const prediction = await buildPrediction();
    // Freeze the ranking before the race, so the track record is the call that
    // was actually made. A logging failure must not cost the forecast.
    await savePrediction(prediction.season, prediction).catch((error) => {
      console.warn("[predict] could not freeze the ranking", error);
      return null;
    });
    const read = await predictionRead(prediction);
    const payload: Payload = { ...prediction, read };
    cached = { at: Date.now(), payload };
    return withGuardHeaders(NextResponse.json(payload), gate);
  } catch {
    return NextResponse.json({ error: "The model could not load season data." }, { status: 502 });
  }
}
