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
