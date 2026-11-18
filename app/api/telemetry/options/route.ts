import { NextResponse } from "next/server";
import { getDriverOptions, getSessionOptions } from "@/lib/openf1";

export const dynamic = "force-dynamic";

/**
 * The picker's data source.
 * `?session=KEY` returns the drivers in that session and the laps each one set;
 * without it, the sessions a visitor can choose from.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = Number.parseInt(searchParams.get("session") ?? "", 10);

  try {
    if (Number.isFinite(session)) {
      const drivers = await getDriverOptions(session);
      return NextResponse.json(drivers);
    }
    const sessions = await getSessionOptions();
    return NextResponse.json(sessions);
  } catch {
    return NextResponse.json({ error: "OpenF1 session list unavailable." }, { status: 502 });
  }
}
