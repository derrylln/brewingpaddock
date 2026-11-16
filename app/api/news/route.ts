import { NextResponse } from "next/server";
import { getNews } from "@/lib/news";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getNews();
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The news wires could not be reached. Try again in a minute." },
      { status: 502 },
    );
  }
}
