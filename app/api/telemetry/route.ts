import { NextResponse } from "next/server";
import { getSelectedTelemetry, getTelemetry } from "@/lib/openf1";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function int(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * No query string: the fastest two laps of the latest race.
 * With `session`, `a`, `lapA`, `b`, `lapB`: exactly the pair the visitor picked.
 *
 * Answers are cached per URL for five minutes and the visitor gets 40 calls a
 * minute, so clicking through sessions cannot spend the OpenF1 allowance the
 * whole site shares.
 */
export async function GET(request: Request) {
  const gate = await guard(request, "telemetry", LIMITS.telemetry.limit, LIMITS.telemetry.windowMs);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const sessionKey = int(searchParams.get("session"));
  const a = int(searchParams.get("a"));
  const lapA = int(searchParams.get("lapA"));
  const b = int(searchParams.get("b"));
  const lapB = int(searchParams.get("lapB"));

  try {
    const payload =
      sessionKey && a && lapA && b && lapB
        ? await getSelectedTelemetry({ sessionKey, a, lapA, b, lapB })
        : await getTelemetry();

    return withGuardHeaders(
      NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        },
      }),
      gate,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telemetry unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
