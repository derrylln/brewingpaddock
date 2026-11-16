import { NextResponse } from "next/server";
import { predictionRead } from "@/lib/ai-reads";
import type { AiRead } from "@/lib/ai";
import { buildPrediction, type Prediction } from "@/lib/predict";

export const dynamic = "force-dynamic";

type Payload = Prediction & { read: AiRead };

// The forecast rebuilds the season archive and runs 4,000 simulations, and its
// written read costs money, so both are held per isolate for ten minutes.
const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; payload: Payload } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  try {
    const prediction = await buildPrediction();
    const read = await predictionRead(prediction);
    const payload: Payload = { ...prediction, read };
    cached = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "The model could not load season data." }, { status: 502 });
  }
}
