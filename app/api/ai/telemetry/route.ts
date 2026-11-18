import { NextResponse } from "next/server";
import { telemetryRead } from "@/lib/ai-reads";
import { getSelectedTelemetry } from "@/lib/openf1";
import { alignLaps, summariseComparison } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

function int(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The visitor picks two laps; the server re-pulls the same pair the dashboard is
 * showing, computes the summary itself, and only then asks the model to explain
 * it. The model never sees — or invents — a number we did not compute.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const session = int(body.session);
    const a = int(body.a);
    const lapA = int(body.lapA);
    const b = int(body.b);
    const lapB = int(body.lapB);
    if (!session || !a || !lapA || !b || !lapB) {
      return NextResponse.json({ error: "Pick two drivers and two laps first." }, { status: 400 });
    }

    const payload = await getSelectedTelemetry({ sessionKey: session, a, lapA, b, lapB });
    const comparison = alignLaps(payload.drivers[0], payload.drivers[1]);
    const summary = summariseComparison(payload.drivers[0], payload.drivers[1], comparison);
    const read = await telemetryRead(payload, summary);

    return NextResponse.json({ read, summary, source: payload.source });
  } catch (error) {
    console.error("[ai/telemetry] failed", error);
    return NextResponse.json({ error: "The engineer could not read those laps." }, { status: 502 });
  }
}
