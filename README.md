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

OpenF1 throttles bursts, so the whole path is cached in two layers (`lib/cache.ts`):
the isolate's memory and Next's data cache (`unstable_cache`, backed by the
deployment's R2 incremental cache), which survives isolate churn. Sessions live
15 minutes, lap and driver lists 30 minutes, a single lap's car trace an hour,
and a chosen pair five minutes — so switching sessions is normally a cache hit,
not an upstream call. The browser is told the same with `Cache-Control`
(`s-maxage` per route).

Each visitor also gets a light throttle (`lib/rate-limit.ts`): 30 telemetry calls
and 20 forecast calls a minute, 6 model calls a minute and 30 an hour, answered
with `429` and `Retry-After`. On top of that, the site as a whole will only make
12 model calls a minute and 120 an hour, so a public link cannot run up a bill
even if the per-visitor buckets are dodged. Visitors are identified by a first-party `bp-vid` cookie (the
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
plan shape (one, two or three stops, and which compounds) is priced across five weighted
scenarios — three track temperatures plus safety-car variants — and the winners
are grouped into the percentages shown. `GET /api/strategy/forecast` builds it
from the calendar; `POST /api/ai/strategy/forecast` adds the desk's read. Below it,
the record freezes each pre-race call and scores it against the pit log.

The weights are set by late-race conditions, not a flat average
(`scenariosFor` in `lib/strategy-forecast.ts`):

- **Safety cars are timed and circuit-specific.** Each circuit has its own
  deployment probability (Marina Bay 60%, Monza 22%, with a formula fallback for
  tracks without a bespoke profile) and 72% of that exposure sits in the second
  half of the race, weighted towards the final quarter. A safety-car scenario now
  passes a window to the stint model, so a stop is only cheap if it actually
  falls inside the deployment — previously the flag discounted stops on lap 2.
- **Track temperature is weighted by degradation pressure.** A high-abrasion
  circuit shifts weight towards the hot-track outcomes, where fresh rubber late
  is worth more; a low-abrasion one shifts it towards the cool, track-position
  races.
- **Track position is priced against a second car.** `neutralTimeline` in
  `lib/strategy.ts` runs a rival that stops where the tyre life says a sensible
  car stops, and every lap a plan spends behind it is charged at the circuit's
  cost of following (0.12s a lap where passing is easy, 0.55s at Monaco and
  Suzuka). Without that rival the optimiser only sees clean air, which is why it
  always picked the late, balanced split; with it, stopping early to get out of
  traffic is worth something. The forecast names the rate it used.
- **Three-stop plans appear when the tyre life demands them.** `planShapes`
  prices a three-stop grid only when the hardest dry tyre cannot cover the race
  in two stints (`tyreLife("hard", abrasion) * 1.15 < laps`), so a high-abrasion
  circuit can express the shapes the field actually runs while a one-stop race
  is not buried in plans that cannot win. The grid reads the profile, so a
  corrected abrasion unlocks the shapes on its own.
- **Tyre life scales with abrasion, not just the rate of loss.** `tyreLife` in
  `lib/strategy.ts` divides the base life by the circuit's abrasion, so a soft
  lasts 32 laps at Monaco and 14 at Lusail, and the total drop at the cliff stays
  the same while the clock moves. The cliff check covers every stint, not only
  the last one, so an over-long opening stint is priced instead of passing as
  low risk. The forecast lists the three lives it used in its assumptions.

Below the forecast is the **track record** (`GET /api/strategy/record`,
`lib/forecast-record.ts`): the last eight completed rounds next to the official
pit-stop log — the winner's stop count, the median stop count and first-stop lap
of the top ten, and whether the favourite's shape matched.

The forecast is **frozen before the race**. The first time the next race's
forecast is built before the lights go out, `lib/pre-race-log.ts` writes it to
the deployment's R2 bucket (`bp-forecast/<season>.json`) and never touches that
entry again, so retuning the model cannot rewrite what was called that week. The
stored entry keeps every priced plan, not just the favourite, so a later model
can be compared with the call actually made. `GET /api/strategy/forecast`
freezes the call; if nobody opens the forecast before the race, that round has
no saved call.

Rounds scored against a frozen entry are marked `saved pre-race`; rounds from
before the log existed — and any round nobody visited in time — are rerun with
today's model and marked `replay`. The panel and the payload both say which is
which, so the table is a track record where one exists and an honestly labelled
backtest where it does not. `locked` in the payload is the next frozen call,
waiting on the flag.

The builder is cheap on a cold start: the bundled snapshot answers for rounds it
already covers, live season results and pit logs are fetched in parallel only
for anything newer, and the log is read alongside the schedule rather than after
it.

A round counts as completed from its **scheduled start plus a race window**, not
from its calendar date, so a race that ran on today's date is scored the same
day. The same start-time rule decides `nextRace`: once the lights go out, `/strategy`
and `/predict` roll on to the next weekend on their own (the calendar is cached
for ten minutes, so a new visitor gets the new race within that window; a tab
left open keeps its old payload until reload).

## Predictor

`/predict` runs the seeded Monte Carlo forecast and, below it, the model's own
track record (`GET /api/predict/record`, `lib/predict-record.ts`). Each completed
round is scored on the model's ordering rather than its simulation noise: was the
winner its top pick, was the winner in its top three, how many of the real podium
and top ten did it place. Headline figures are "winner in top three", podium hit
rate and top-ten hit rate across the last eight rounds.

The ranking is frozen before the race by the same log (`bp-predict/<season>.json`)
and `savePrediction`, so rounds called after this shipped are marked `saved` and
cannot be rewritten by a retune. Older rounds are `replay`: the five factors are
run on the data available at the time — every round before the target, with that
race's grid standing in for a qualifying session the archive does not keep.

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
| `AI_MODEL` | no | `gemini-3.5-flash-lite` |
| `AI_API_BASE` | no | `https://generativelanguage.googleapis.com/v1beta/openai` |

Requests use Gemini's OpenAI-compatible chat-completions endpoint with a Bearer key, so any other
OpenAI-compatible endpoint works too (`https://api.openai.com/v1`, OpenRouter, Groq, …). `gemini-2.5-flash`
is deprecated and re-routes after 1 December 2026. The default is `gemini-3.5-flash-lite`, because the
bigger sibling spends time answering `503 high demand` (and `gemini-3.8-flash` returned a gateway
timeout while this was written). The client fails over on 408/429/5xx and timeouts, and gives up
immediately on auth or billing errors, which would fail the same way on every model. Each read is
memoised in the shared data cache for fifteen minutes, so a repeat view costs no model call.

Telemetry has no model call at all: the chart is the explanation, and the panel that asked the model
to narrate it has been removed along with `POST /api/ai/telemetry`.

Where it plugs in:

- `POST /api/ask` — retrieval answers first, the model rephrases (grounded, same numbers).
- `POST /api/ai/strategy/forecast` — rebuilds the race forecast from the calendar, then reads it.
- `GET /api/predict` — adds `read` to the forecast payload, cached ten minutes per instance.
- `/race/[round]` — extra analysis on the latest round only, so the archive costs nothing.

Without a key, or if a call fails or the budget is spent, each surface falls back to the computed
read and labels itself `model only` rather than erroring. Generation is throttled per visitor
(6/minute and 30/hour) and for the site as a whole (12/minute and 120/hour), counted in the
deployment's R2 bucket rather than isolate memory, so a public link cannot spend the owner's
credits without bound.

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
