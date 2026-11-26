import { aiEnabled, aiText, type AiCompletion, type AiRead } from "@/lib/ai";
import { cached } from "@/lib/cache";
import type { Prediction } from "@/lib/predict";
import type { StrategyForecast } from "@/lib/strategy-forecast";

/**
 * Grounded generation for each module.
 *
 * Every function hands the model a data block computed by the deterministic
 * models and asks it only to interpret that block. The numbers on screen never
 * come from the model — it writes the read, the models own the arithmetic.
 * If the key is missing, the call fails or the budget is spent, the caller gets
 * the computed read instead of an error.
 */

const VOICE = `You are the Brewing Paddock strategy desk: a Formula 1 analyst writing for a pit-wall audience.
Rules you never break:
- Use only the numbers and facts in the DATA block. Never invent a stat, name, lap time or result.
- If the data does not support a claim, say so plainly instead of filling the gap.
- British English. Plain sentences. No emoji, no markdown, no headings, no bullet lists.
- Two short paragraphs at most, under 110 words total.
- Sound like a race engineer briefing a principal: specific, unsentimental, allergic to filler.`;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * A generated read is deterministic enough to keep: same inputs, same brief. The
 * model call is the slowest thing in every module (seconds, not milliseconds),
 * so each read is memoised in the shared data cache for fifteen minutes. The
 * cached value is a plain object, which is why this can live here.
 */
function memoRead(key: string, produce: () => Promise<AiRead>): Promise<AiRead> {
  return cached(`ai:${key}`, 15 * 60_000, produce);
}

function asRead(completion: AiCompletion | null, fallback: string): AiRead {
  return completion
    ? { text: completion.text, source: "ai", model: completion.model }
    : { text: fallback, source: "model", model: null };
}

/** Forecast narrative for the predictor. */
export async function predictionRead(prediction: Prediction): Promise<AiRead> {
  const top = prediction.rows.slice(0, 6);
  const favourite = top[0];

  const fallback = favourite
    ? `${favourite.name} tops the simulation on ${pct(favourite.win)} for the ${prediction.race.name}, with ${
        top[1] ? `${top[1].name} next on ${pct(top[1].win)}` : "the field behind"
      } and ${top[2] ? `${top[2].name} on ${pct(top[2].win)}` : "no clear third favourite"}. ${
        prediction.sims.toLocaleString("en-GB")
      } seeded races built on ${prediction.dataPoints} classification rows — read the top three as a live fight, not a settled order.`
    : "The simulation returned no rows, so there is no read to give.";

  const data = [
    `Race: ${prediction.race.name}, round ${prediction.race.round}, ${prediction.race.circuit}, ${prediction.race.date}.`,
    `Simulations: ${prediction.sims}. Classification rows modelled: ${prediction.dataPoints}.`,
    `Method: ${prediction.method.join(" ")}`,
    prediction.backtest
      ? `Backtest on the ${prediction.backtest.raceName}: predicted ${prediction.backtest.predicted.join(
          ", ",
        )}; actual ${prediction.backtest.actual.join(", ")}; ${prediction.backtest.hits} of 3 matched.`
      : "No backtest available for this forecast.",
    "Top six:",
    ...top.map(
      (row, index) =>
        `${index + 1}. ${row.name} (${row.code}, ${row.team}) — win ${pct(row.win)}, podium ${pct(
          row.podium,
        )}, points ${pct(row.points)}, DNF risk ${pct(row.dnfRisk)}, composite score ${(
          row.score * 100
        ).toFixed(0)}/100.`,
    ),
  ].join("\n");

  // Keyed on the board, not just the round: once qualifying lands the ranking
  // changes, and a read written on the old grid must not describe the new one.
  return memoRead(
    `predict:v3:${prediction.race.round}:${prediction.weekend.quali}:${top[0]?.code ?? "none"}`,
    async () => {
      const completion = await aiText({
        system: VOICE,
        user: `DATA\n${data}\n\nTASK\nWrite the desk's read on this forecast: who the model favours and how clear that is, what the spread between the top three means for confidence, and the single assumption most likely to break the call. Do not re-list the table.`,
        maxTokens: 260,
      });

      return asRead(completion, fallback);
    },
  );
}

/** Extra analysis on a completed race, on top of the template debrief. */
export async function debriefRead(
  facts: {
    raceName: string;
    headline: string;
    deck: string;
    stats: Array<{ label: string; value: string; note: string }>;
    paragraphs: string[];
  },
  resultsCount: number,
): Promise<AiRead | null> {
  if (!aiEnabled()) return null;

  const data = [
    `Race: ${facts.raceName}. Classified runners: ${resultsCount}.`,
    `Headline: ${facts.headline}`,
    `Summary: ${facts.deck}`,
    `Stats: ${facts.stats.map((stat) => `${stat.label} ${stat.value} (${stat.note})`).join("; ")}.`,
    `Template copy already shown to the reader: ${facts.paragraphs.join(" ")}`,
  ].join("\n");

  const completion = await aiText({
    system: VOICE,
    user: `DATA\n${data}\n\nTASK\nWrite two paragraphs that add something the template copy does not: the strategic story of the race — where the win was actually decided, and what it means for the next round. Use only these facts. Do not repeat the headline.`,
    maxTokens: 300,
  });

  return completion
    ? { text: completion.text, source: "ai", model: completion.model }
    : null;
}

/** Read on the pre-weekend race-plan forecast. */
export async function forecastRead(forecast: StrategyForecast): Promise<AiRead> {
  const favourite = forecast.plans[0];
  const fallback = favourite ? forecast.call : "The forecast returned no plans.";

  const data = [
    `Race: ${forecast.race.name}, round ${forecast.race.round}, ${forecast.race.date}.`,
    `Circuit model: ${forecast.race.circuitName}, ${forecast.race.laps} laps.`,
    `Scenarios priced: ${forecast.scenarios}. Assumptions: ${forecast.assumptions.join(" ")}`,
    "Ranked plans:",
    ...forecast.plans.map(
      (plan, index) =>
        `${index + 1}. ${plan.label} — ${Math.round(plan.probability * 100)}% of scenarios, ${plan.stops} stop(s), pit laps ${plan.pitLaps.length ? plan.pitLaps.join("/") : "none"}, ${plan.risk} risk, ${plan.delta.toFixed(1)}s off the fastest projection.`,
    ),
  ].join("\n");

  return memoRead(`forecast:v2:${forecast.race.round}`, async () => {
    const completion = await aiText({
      system: VOICE,
      user: `DATA\n${data}\n\nTASK\nWrite the pre-weekend strategy read: what the most likely plan is and why the tyre model likes it, how much the alternatives give up, and the single race event most likely to flip the call. Do not restate the percentages table.`,
      maxTokens: 250,
    });

    return asRead(completion, fallback);
  });
}
