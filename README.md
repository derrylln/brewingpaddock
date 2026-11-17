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

## Theme and type

The light/dark switch in the header writes `bp-theme` to localStorage and sets
`data-theme` on `<html>`; an inline script in `app/layout.tsx` applies it before
first paint, so there is no flash. Dark is the default. Every colour is a token
in `app/globals.css` (`--bg`, `--ink`, `--red`, plus the `--wash-rgb` overlay
channel), with the light palette under `:root[data-theme="light"]` — new surfaces
should use those tokens rather than hard-coded hexes.

Display type is **Magistral**, a licensed ParaType face, so the repo ships the
free stand-in **Chakra Petch** (squared, Eurostile-lineage) in its place. The
stack already lists `Magistral` first: buy the woff2 files, drop them in
`public/fonts/`, and uncomment the `@font-face` block at the end of
`app/globals.css`. The "Brewed by Brewing Paddock" footer line is Times New Roman.

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
   on KV here.
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
