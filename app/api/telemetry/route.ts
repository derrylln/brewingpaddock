import { NextResponse } from "next/server";
import { getSelectedTelemetry, getTelemetry } from "@/lib/openf1";

export const dynamic = "force-dynamic";

function int(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * No query string: the fastest two laps of the latest race.
 * With `session`, `a`, `lapA`, `b`, `lapB`: exactly the pair the visitor picked.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionKey = int(searchParams.get("session"));
  const a = int(searchParams.get("a"));
  const lapA = int(searchParams.get("lapA"));
  const b = int(searchParams.get("b"));
  const lapB = int(searchParams.get("lapB"));

  try {
    if (sessionKey && a && lapA && b && lapB) {
      const payload = await getSelectedTelemetry({ sessionKey, a, lapA, b, lapB });
      return NextResponse.json(payload);
    }
    const payload = await getTelemetry();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telemetry unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
