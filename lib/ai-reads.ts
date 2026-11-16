import { aiEnabled, aiText, type AiCompletion, type AiRead } from "@/lib/ai";
import type { AskAnswer } from "@/lib/knowledge";
import type { Prediction } from "@/lib/predict";
import type { StrategyInput, StrategyResult } from "@/lib/strategy";

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

  const completion = await aiText({
    system: VOICE,
    user: `DATA\n${data}\n\nTASK\nWrite the desk's read on this forecast: who the model favours and how clear that is, what the spread between the top three means for confidence, and the single assumption most likely to break the call. Do not re-list the table.`,
    maxTokens: 260,
  });

  return asRead(completion, fallback);
}

/** Pit-wall read on a simulated strategy call. */
export async function strategyRead(input: StrategyInput, result: StrategyResult): Promise<AiRead> {
  const best = result.options[0];
  const gain = result.baseline - best.totalTime;
  const fallback = `${result.call} Projected ${Math.abs(gain).toFixed(1)}s ${
    gain >= 0 ? "better" : "worse"
  } than staying out to the flag, at ${best.risk} risk.`;

  const alternatives = result.options
    .slice(1, 5)
    .map(
      (option) =>
        `- ${option.label}: ${option.stops} stop(s), +${option.delta.toFixed(1)}s versus the best plan, ${option.risk} risk.`,
    )
    .join("\n");

  const data = [
    `Scenario: lap ${input.lap} of ${input.totalLaps}, on ${input.compound} tyres with ${input.tyreAge} laps on them.`,
    `Gap ahead ${input.gapAhead}s, gap behind ${input.gapBehind}s. Track temperature ${input.trackTemp}°C, conditions ${input.rain}${input.safetyCar ? ", safety car deployed" : ""}.`,
    `Recommended plan: ${best.label} — ${best.stops} stop(s), ${best.risk} risk, ${
      gain >= 0 ? "−" : "+"
    }${Math.abs(gain).toFixed(1)}s versus no further stop, projected total ${best.totalTime.toFixed(1)}s.`,
    best.notes.length ? `Model notes: ${best.notes.join(" ")}` : "",
    alternatives ? `Alternatives:\n${alternatives}` : "",
    `Model summary: ${result.call}`,
    `Undercut: ${result.undercut}`,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await aiText({
    system: VOICE,
    user: `DATA\n${data}\n\nTASK\nGive the pit-wall read on this call: why it wins, what it costs in track position or tyre life, and the one trigger that should change it. Do not repeat the option table.`,
    maxTokens: 240,
  });

  return asRead(completion, fallback);
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

/** Natural-language rendering of an already grounded, source-cited answer. */
export async function polishAnswer(question: string, base: AskAnswer): Promise<AiRead | null> {
  if (!aiEnabled()) return null;

  const data = [
    `Question: ${question}`,
    `Grounded answer: ${base.answer}`,
    base.bullets?.length ? `Supporting points: ${base.bullets.join(" | ")}` : "",
    base.table
      ? `Table already shown under the answer: ${base.table.columns.join(", ")} — rows: ${base.table.rows
          .map((row) => row.join(" / "))
          .join(" | ")}`
      : "",
    `Sources: ${base.citations.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await aiText({
    system: `${VOICE}
You are answering a reader's question directly in the desk's voice. Never mention models, retrieval or databases. Keep every number identical to the grounded answer and never contradict it. If the grounded answer says the data does not cover the question, say that in one sentence.`,
    user: `DATA\n${data}\n\nTASK\nAnswer the question in one to three sentences using only this data. No preamble, no restating of the question, no table.`,
    maxTokens: 180,
    temperature: 0.25,
  });

  return completion
    ? { text: completion.text, source: "ai", model: completion.model }
    : null;
}
