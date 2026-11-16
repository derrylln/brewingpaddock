import { NextResponse } from "next/server";
import { getTelemetry } from "@/lib/openf1";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getTelemetry();
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Telemetry unavailable." }, { status: 502 });
  }
}
