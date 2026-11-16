export type NewsCategory =
  | "Race Report"
  | "Strategy"
  | "Tech"
  | "Market"
  | "Opinion"
  | "Paddock";

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  sourceKey: string;
  excerpt: string;
  image: string | null;
  publishedAt: string;
  category: NewsCategory;
};

export type NewsSource = { key: string; name: string; ok: boolean; count: number };

export type NewsPayload = {
  items: NewsItem[];
  sources: NewsSource[];
  fetchedAt: string;
};

const FEEDS: Array<{ key: string; name: string; url: string }> = [
  { key: "the-race", name: "The Race", url: "https://www.the-race.com/feed/" },
  { key: "motorsport", name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
  { key: "autosport", name: "Autosport", url: "https://www.autosport.com/rss/f1/news/" },
  { key: "racefans", name: "RaceFans", url: "https://www.racefans.net/feed/" },
  { key: "motorsportweek", name: "Motorsport Week", url: "https://www.motorsportweek.com/feed/" },
  { key: "racer", name: "RACER", url: "https://racer.com/category/formula-1/feed/" },
  { key: "espn", name: "ESPN F1", url: "https://www.espn.com/espn/rss/f1/news" },
];

const UA =
  "Mozilla/5.0 (compatible; BrewingPaddock/1.0; +https://brewingpaddock.com) AppleWebKit/537.36";

function decode(input: string): string {
  let text = input;
  const cdata = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) text = cdata[1];
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&#39;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1]) : "";
}

function attr(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}[^>]*url=["']([^"']+)["']`, "i"));
  return match ? match[1] : "";
}

function firstImage(item: string): string | null {
  const media = attr(item, "media:content") || attr(item, "media:thumbnail");
  if (media) return media;
  const enclosure = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
  if (enclosure && /\.(jpe?g|png|webp)$/i.test(enclosure[1])) return enclosure[1];
  const body = item.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
  const haystack = body ? body[1] : item;
  const img = haystack.match(/<img[^>]+src=["']([^"']+)["']/i);
  return img ? img[1] : null;
}

function categorise(title: string, excerpt: string): NewsCategory {
  const hay = `${title} ${excerpt}`.toLowerCase();
  if (/\b(wins?|won|victory|victorious|podium|grand prix report|gp report|race report|chaotic|dominant)\b/.test(hay))
    return "Race Report";
  if (/\b(sign|signs|signed|contract|transfer|driver market|replace|replacement|seat|line-?up|exit|departure|silly season)\b/.test(hay))
    return "Market";
  if (/\b(upgrade|floor|wing|aero|aerodynamic|power unit|engine|suspension|diffuser|sidepod|chassis|simulator|wind tunnel|technical)\b/.test(hay))
    return "Tech";
  if (/\b(strategy|pit stop|pit wall|tyre|tire|undercut|overcut|safety car|gamble|compound|degradation)\b/.test(hay))
    return "Strategy";
  if (/\b(opinion|column|analysis|verdict|why|debate|ranked|rated|the big|explained)\b/.test(hay))
    return "Opinion";
  return "Paddock";
}

function parseFeed(xml: string, source: { key: string; name: string }): NewsItem[] {
  const chunks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const entries: NewsItem[] = [];

  for (const chunk of chunks) {
    const title = tag(chunk, "title");
    const link = tag(chunk, "link") || tag(chunk, "guid");
    if (!title || !link) continue;
    const excerptRaw = tag(chunk, "description");
    const excerpt =
      excerptRaw.length > 260 ? `${excerptRaw.slice(0, 257).trimEnd()}…` : excerptRaw;
    const dateRaw = tag(chunk, "pubDate") || tag(chunk, "dc:date") || tag(chunk, "published");
    // Skip undated entries rather than passing them off as breaking news.
    if (!dateRaw) continue;
    const parsed = new Date(dateRaw);
    if (Number.isNaN(parsed.getTime())) continue;
    entries.push({
      id: `${source.key}:${link}`,
      title,
      link,
      source: source.name,
      sourceKey: source.key,
      excerpt,
      image: firstImage(chunk),
      publishedAt: parsed.toISOString(),
      category: categorise(title, excerpt),
    });
  }
  return entries;
}

function dedupe(items: NewsItem[]): NewsItem[] {
  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const cleanLink = item.link.split("?")[0].replace(/\/$/, "");
    const titleKey = item.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .slice(0, 7)
      .join(" ");
    if (seenLinks.has(cleanLink) || seenTitles.has(titleKey)) continue;
    seenLinks.add(cleanLink);
    seenTitles.add(titleKey);
    out.push(item);
  }
  return out;
}

async function fetchFeed(source: { key: string; name: string; url: string }) {
  const res = await fetch(source.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 240 },
  });
  if (!res.ok) throw new Error(`${source.key}: ${res.status}`);
  return parseFeed(await res.text(), source);
}

export async function getNews(): Promise<NewsPayload> {
  const results = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)));
  const items: NewsItem[] = [];
  const sources: NewsSource[] = [];

  results.forEach((result, index) => {
    const source = FEEDS[index];
    if (result.status === "fulfilled") {
      items.push(...result.value);
      sources.push({ key: source.key, name: source.name, ok: true, count: result.value.length });
    } else {
      sources.push({ key: source.key, name: source.name, ok: false, count: 0 });
    }
  });

  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return {
    items: dedupe(items).slice(0, 48),
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
