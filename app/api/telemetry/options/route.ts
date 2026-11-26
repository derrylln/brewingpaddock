import { NextResponse } from "next/server";
import { getDriverOptions, getSessionOptions } from "@/lib/openf1";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The picker's data source.
 * `?session=KEY` returns the drivers in that session and the laps each one set;
 * without it, the sessions a visitor can choose from.
 *
 * Both lists are cached for 15–30 minutes (isolate memory + the Next data cache
 * on R2), so a session switch normally costs zero upstream calls.
 */
export async function GET(request: Request) {
  const gate = await guard(request, "telemetry", LIMITS.telemetry.limit, LIMITS.telemetry.windowMs);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const session = Number.parseInt(searchParams.get("session") ?? "", 10);

  try {
    const body = Number.isFinite(session)
      ? await getDriverOptions(session)
      : await getSessionOptions();

    return withGuardHeaders(
      NextResponse.json(body, {
        headers: {
          "Cache-Control": "public, max-age=120, s-maxage=600, stale-while-revalidate=1800",
        },
      }),
      gate,
    );
  } catch {
    return NextResponse.json({ error: "OpenF1 session list unavailable." }, { status: 502 });
  }
}
