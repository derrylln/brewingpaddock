import { NextResponse } from "next/server";
import { getInstagramPosts } from "@/lib/instagram";

export const revalidate = 1800;

/**
 * Debug / refresh endpoint for the coverflow. Mirrors what the homepage renders:
 * live Graph API posts when INSTAGRAM_TOKEN is set, the curated list otherwise.
 */
export async function GET() {
  const posts = await getInstagramPosts();
  return NextResponse.json(
    { count: posts.length, source: process.env.INSTAGRAM_TOKEN ? "instagram" : "curated", posts },
    { headers: { "cache-control": "public, s-maxage=1800, stale-while-revalidate=86400" } },
  );
}
