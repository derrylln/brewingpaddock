import { NextResponse } from "next/server";
import { predictionRead } from "@/lib/ai-reads";
import type { AiRead } from "@/lib/ai";
import { papersNotes, type PapersNotes } from "@/lib/papers-notes";
import { buildPrediction, weekendQualiReady, type Prediction } from "@/lib/predict";
import { savePrediction } from "@/lib/pre-race-log";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Payload = Prediction & { read: AiRead; notes: PapersNotes };

// The forecast rebuilds the season archive and runs 4,000 simulations, and its
// written read costs money, so both are held per isolate. The hold never
// outlives the grid it was built on: see the check below.
const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; payload: Payload } | null = null;

export async function GET(request: Request) {
  const gate = await guard(request, "ai", LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!gate.ok) return gate.response;
  const hourly = await guard(request, "ai-hour", LIMITS.aiHourly.limit, LIMITS.aiHourly.windowMs);
  if (!hourly.ok) return hourly.response;

  if (cached && Date.now() - cached.at < TTL_MS) {
    // A board built before Saturday cannot survive the session it waits for.
    // Once this weekend's qualifying lands, drop the held copy and simulate
    // again on the real grid — no visitor action needed.
    const qualiLanded = await weekendQualiReady(cached.payload).catch(() => false);
    if (!qualiLanded) return withGuardHeaders(NextResponse.json(cached.payload), gate);
  }

  try {
    const prediction = await buildPrediction();
    // Freeze the ranking before the race, so the track record is the call that
    // was actually made. A logging failure must not cost the forecast.
    await savePrediction(prediction.season, prediction).catch((error) => {
      console.warn("[predict] could not freeze the ranking", error);
      return null;
    });
    // The papers' FYI lines ride along with the read: both are one model call
    // behind a ten-minute cache, and neither touches the simulated numbers.
    const [read, notes] = await Promise.all([
      predictionRead(prediction),
      papersNotes(prediction),
    ]);
    const payload: Payload = { ...prediction, read, notes };
    cached = { at: Date.now(), payload };
    return withGuardHeaders(NextResponse.json(payload), gate);
  } catch {
    return NextResponse.json({ error: "The model could not load season data." }, { status: 502 });
  }
}
