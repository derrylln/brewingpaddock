import curated from "@/data/instagram.json";

export type IgPost = {
  id: string;
  image: string;
  caption: string;
  permalink: string;
  kind: "post" | "reel";
  timestamp?: string;
};

const HANDLE = "brewingpaddock";

/**
 * Live posts come from the Instagram API with Instagram Login
 * (graph.instagram.com) — the Basic Display API was retired in December 2024.
 * It needs a Business/Creator account and a long-lived access token in
 * INSTAGRAM_TOKEN. Without a token the curated list in data/instagram.json is
 * used, so the section always renders.
 */
export async function getInstagramPosts(): Promise<IgPost[]> {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) return curated as IgPost[];

  try {
    const url =
      "https://graph.instagram.com/me/media" +
      "?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count" +
      `&limit=12&access_token=${encodeURIComponent(token)}`;

    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return curated as IgPost[];

    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        caption?: string;
        media_type?: string;
        media_url?: string;
        thumbnail_url?: string;
        permalink?: string;
        timestamp?: string;
      }>;
    };

    const posts = (json.data ?? [])
      .map((m): IgPost | null => {
        const isVideo = m.media_type === "VIDEO";
        const image = isVideo ? m.thumbnail_url : m.media_url;
        if (!image || !m.permalink) return null;
        return {
          id: m.id,
          image,
          caption: (m.caption ?? "").split("\n")[0].slice(0, 180),
          permalink: m.permalink,
          kind: isVideo ? ("reel" as const) : ("post" as const),
          timestamp: m.timestamp,
        };
      })
      .filter((p): p is IgPost => p !== null);

    return posts.length ? posts : (curated as IgPost[]);
  } catch {
    return curated as IgPost[];
  }
}

export const instagramHandle = HANDLE;
export const instagramUrl = `https://www.instagram.com/${HANDLE}/`;
