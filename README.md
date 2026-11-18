# Brewing Paddock

F1 news desk and race-data workbench: live standings, every 2026 classification, OpenF1 telemetry,
a stint simulator, a Monte Carlo predictor and a grounded race assistant.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
```

Data sources: Jolpica (standings, results, calendar), OpenF1 (telemetry), seven RSS news desks.
A bundled snapshot in `data/snapshot.json` covers the season when Jolpica rate-limits the host.

## Logo

The mark in the header is a file, not code: `public/brand/logo.png`. It is cut
from `logooo.png` in the repo root — the brand's own artwork, 1080×1350 with the
mark centred in transparent padding. Regenerate it (trim to the alpha bounding
box, pad 10%, square, resize) with:

```python
from PIL import Image
src = Image.open("logooo.png").convert("RGBA")
ink = src.crop(src.getchannel("A").getbbox())
side = max(ink.size); pad = int(side * 0.10)
canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
canvas.paste(ink, ((canvas.width - ink.width) // 2, (canvas.height - ink.height) // 2), ink)
canvas.resize((512, 512), Image.LANCZOS).save("public/brand/logo.png")
```

The favicon is `app/icon.png`, the same mark on the paper ground. Colour and size
come from `.brand-mark` in `app/globals.css` (26px in the header). A previous
crop shipped an almost-blank file — if the header ever looks empty, check the PNG
alpha channel first, not the CSS.

## Telemetry

`/telemetry` is a picker, not a fixed view: session (recent races, qualifying and
sprints), both drivers, and the exact lap for each. Everything comes from OpenF1:

| Endpoint | Returns |
| --- | --- |
| `GET /api/telemetry/options` | sessions a visitor can choose |
| `GET /api/telemetry/options?session=KEY` | drivers in that session, with the laps each set |
| `GET /api/telemetry?session=&a=&lapA=&b=&lapB=` | the two traces, distance-aligned |
| `GET /api/telemetry` | the fastest two laps of the latest race (first paint) |
| `POST /api/ai/telemetry` | the engineer's read on the chosen pair |

OpenF1 throttles bursts, so the whole path is cached in two layers (`lib/cache.ts`):
the isolate's memory and Next's data cache (`unstable_cache`, backed by the
deployment's R2 incremental cache), which survives isolate churn. Sessions live
15 minutes, lap and driver lists 30 minutes, a single lap's car trace an hour,
and a chosen pair five minutes — so switching sessions is normally a cache hit,
not an upstream call. The browser is told the same with `Cache-Control`
(`s-maxage` per route).

Each visitor also gets a light throttle (`lib/rate-limit.ts`): 30 telemetry calls
and 20 forecast calls a minute, 8 model calls a minute, answered with `429` and
`Retry-After`. Visitors are identified by a first-party `bp-vid` cookie (the
platform does not forward the client IP, so IP is only a fallback for cookie-less
requests), and the counters live in R2 rather than isolate memory — requests land
on fresh isolates, so in-memory buckets never fill. This is a fairness valve, not
security: it stops one person clicking through sessions from spending the OpenF1
allowance the whole site shares.

When upstream still fails, a stale copy (up to 24 hours) is served rather than an
error. A pair that genuinely has no car data returns an error instead of quietly
showing different drivers — the dashboard keeps the previous chart and offers
Retry, and the first paint can always fall back to the bundled
`data/telemetry-brazil-2026.json` pair.

## Strategist

`/strategy` opens with a pre-weekend forecast for the next race: every sensible
plan shape (one stop, two stops, which compounds) is priced across five weighted
scenarios — three track temperatures plus safety-car variants — and the winners
are grouped into the percentages shown. `GET /api/strategy/forecast` builds it
from the calendar; `POST /api/ai/strategy/forecast` adds the desk's read. The
scenario lab below it is unchanged: set a lap, tyre, gaps and weather and price
every window from there.

## Instagram feed

The homepage cover flow reads from `lib/instagram.ts`. With an
`INSTAGRAM_TOKEN` in the environment it calls the Instagram API with Instagram
Login (`graph.instagram.com/me/media`, cached 30 min); without one it renders the
curated list in `data/instagram.json`, which is what ships today.

To go live:

1. The account must be **Business or Creator** (Instagram app → Settings → Account
   type). Personal accounts cannot be read by any Meta API since the Basic Display
   API was retired on 4 December 2024.
2. Create a Meta app at developers.facebook.com with the **Instagram** product and
   the `instagram_business_basic` permission, then generate a long-lived access
   token for @brewingpaddock.
3. Store it as a secret named `INSTAGRAM_TOKEN` — on Freebuff Sites under **Sites →
   Secrets**, on your own Worker with `wrangler secret put INSTAGRAM_TOKEN`.
4. Redeploy. `GET /api/instagram` shows what the section is serving (source:
   `instagram` or `curated`).

Long-lived tokens last about 60 days; refresh before they expire or the section
falls back to the curated list. The placeholder tiles in `public/instagram/` are
generated brand artwork — replace entries in `data/instagram.json` (or configure
the token) to show real posts.

## Theme and type

The light/dark switch in the header writes `bp-theme` to localStorage and sets
`data-theme` on `<html>`; an inline script in `app/layout.tsx` applies it before
first paint, so there is no flash. Light (white paper, the poster look) is the
default; dark is the option. Every colour is a token
in `app/globals.css` (`--bg`, `--ink`, `--red`, plus the `--wash-rgb` overlay
channel), with the light palette under `:root[data-theme="light"]` — new surfaces
should use those tokens rather than hard-coded hexes.

Display type is **Magistral** (licensed ParaType family, supplied by the brand).
`public/fonts/` holds Latin subsets converted to woff2 from the OTF originals in
`fonnts.com-236668.zip`; regenerate with:

```sh
pip install fonttools brotli
python3 -m fontTools.subset fonnts.com-Magistral_Cond_Extra_Bold.otf \
  --flavor=woff2 --output-file=public/fonts/magistral-cond-extrabold.woff2 \
  --unicodes="U+0020-00FF,U+2000-206F,U+20A0-20BF,U+2122,U+2190-21FF,U+2212"
```

Two tiers in `app/globals.css`: the poster treatment is limited to display-scale
headings (`.hero-title`, `.page-title`, `.race-title`, `.debrief-headline`,
`.section-title`, `.race-card-title`) and uses **Magistral Cond** Extra Bold — the
family ships no condensed italic, so that slant is synthesised. Card-scale
headings (`.module-title`, `.champ-name`, `.telemetry-title`, `.predict-title`)
use Cond Extra Bold upright; 900 italic at card size reads as shouting. Body copy
is Magistral Book, and **Archivo** is only a fallback.

Magistral carries no arrow glyphs, so the stack ends in `JetBrains Mono` to keep
↗ and → consistent. If the licensed files are ever replaced, drop the new woff2s
into `public/fonts/` and keep the `@font-face` block at the end of `app/globals.css`
in step. The "Brewed by Brewing Paddock" footer line is Times New Roman.

## AI

Each module ships a deterministic model that owns the numbers — stint simulation, Monte Carlo,
retrieval over the season archive. A language model adds the written read on top. It never computes a
result, and every prompt is handed only the data block the models produced.

AI is off until a key is present. On Freebuff Sites, add these under **Sites → Secrets** and redeploy:

| Variable | Required | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes (aliases `GOOGLE_API_KEY`, `AI_API_KEY`) | — |
| `AI_MODEL` | no | `gemini-3.5-flash` |
| `AI_API_BASE` | no | `https://generativelanguage.googleapis.com/v1beta/openai` |

Requests use Gemini's OpenAI-compatible chat-completions endpoint with a Bearer key, so any other
OpenAI-compatible endpoint works too (`https://api.openai.com/v1`, OpenRouter, Groq, …). `gemini-2.5-flash`
is deprecated and re-routes after 1 December 2026 — `gemini-3.5-flash` and `gemini-3.5-flash-lite` are
the current picks; an unknown model falls back to the next one instead of failing the page.

Where it plugs in:

- `POST /api/ask` — retrieval answers first, the model rephrases (grounded, same numbers).
- `POST /api/ai/strategy` — recomputes the plan server-side, then writes the read.
- `POST /api/ai/strategy/forecast` — rebuilds the race forecast from the calendar, then reads it.
- `POST /api/ai/telemetry` — re-pulls the chosen pair, recomputes the summary, then explains it.
- `GET /api/predict` — adds `read` to the forecast payload, cached ten minutes per instance.
- `/race/[round]` — extra analysis on the latest round only, so the archive costs nothing.

Without a key, or if a call fails or the budget is spent, each surface falls back to the computed
read and labels itself `model only` rather than erroring. Generation is capped per worker instance
(20/minute, 240/hour) so a public link cannot spend the owner's credits without bound.

## Deploying to your own Cloudflare account

The repo is wired for Cloudflare **Workers Builds** (Git integration): push to `main` and Cloudflare
builds and deploys. No Cloudflare token and no GitHub Actions secret lives in this repository.

1. Create the ISR cache: **Storage & databases → Workers KV → Create instance**, named
   `brewing-paddock-cache`. Copy its **ID** and paste it into `wrangler.jsonc` in place of the zeros in
   `NEXT_INC_CACHE_KV`. KV is free and needs no payment method — unlike R2, which is why the cache is
   on KV here. The per-visitor counters also live in R2 (`NEXT_INC_CACHE_R2_BUCKET`); on a KV-only
   account they fall back to per-isolate memory, which still throttles a burst but is looser than the
   hosted preview.
2. **Workers & Pages → Create → Worker → Connect to Git**, pick `derrylln/brewingpaddock`, branch `main`.
3. Name the Worker **`brewing-paddock`** — it must match `name` in `wrangler.jsonc` or the build fails.
4. Build command: `npm run build:worker` · Deploy command: `npm run deploy:worker`.
5. **Settings → Variables and Secrets** → add `GEMINI_API_KEY`. Without it the site still runs; the
   analysis panels show the computed read tagged `model only`.
6. Push a commit (or Deployments → Retry) to build and deploy.

Free-plan allowances in play: Workers Builds 3,000 build minutes/month, Workers 100,000 requests/day,
Workers KV (100,000 reads + 1,000 writes/day), and SQLite-backed Durable Objects on the free tier. No
payment method and no paid plan are required anywhere in this setup.

The Freebuff preview at `freebuff.page` is a separate deployment with its own secret; publishing
there is unaffected by any of the above.
