"use client";

import { useEffect, useState } from "react";
import type { AiRead } from "@/lib/ai";
import type { StrategyForecast } from "@/lib/strategy-forecast";

const COMPOUND_NAME: Record<string, string> = {
  soft: "Soft",
  medium: "Medium",
  hard: "Hard",
  inter: "Inter",
  wet: "Wet",
};

function day(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Pre-weekend plan forecast: what the stint model thinks each team will do on
 * Sunday, before a single lap has been run. The percentages come from pricing
 * every sensible plan under several weather and safety-car scenarios.
 */
export default function StrategyForecastPanel() {
  const [forecast, setForecast] = useState<StrategyForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<AiRead | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/strategy/forecast")
      .then((res) => {
        if (!res.ok) throw new Error("The forecast is unavailable.");
        return res.json() as Promise<StrategyForecast>;
      })
      .then((data) => alive && setForecast(data))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  const askDesk = async () => {
    if (!forecast) return;
    setReading(true);
    try {
      const res = await fetch("/api/ai/strategy/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: forecast.race.round }),
      });
      if (!res.ok) throw new Error("offline");
      const data = (await res.json()) as { read: AiRead };
      setRead(data.read);
    } catch {
      setRead({ text: forecast.call, source: "model", model: null });
    } finally {
      setReading(false);
    }
  };

  if (error) {
    return (
      <div className="panel empty-state">
        <p className="mono kicker-red">FORECAST OFFLINE</p>
        <h3>The calendar did not answer.</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="panel forecast-loading">
        <div className="sk-line w40" />
        <div className="sk-line w80" />
        <p className="mono">Pricing every race plan…</p>
      </div>
    );
  }

  const { race, plans } = forecast;

  return (
    <section className="forecast">
      <div className="forecast-head">
        <div>
          <p className="mono kicker-red">
            Round {race.round} · {day(race.date)}
          </p>
          <h2 className="forecast-title">{race.name.replace(" Grand Prix", "")}</h2>
          <p className="mono forecast-sub">
            {race.circuitName} · {race.laps} laps · {race.country}
          </p>
        </div>
        <div className="forecast-method">
          <span className="mono">Most likely plan</span>
          <strong>{forecast.call.split(".")[0]}.</strong>
          <span className="mono forecast-scenarios">{forecast.scenarios} scenarios priced</span>
        </div>
      </div>

      <div className="forecast-plans">
        {plans.map((plan, index) => (
          <article key={plan.id} className={`plan-card${index === 0 ? " is-favourite" : ""}`}>
            <div className="plan-top">
              <span className="mono plan-rank">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="plan-label">{plan.label}</h3>
              <span className="mono plan-prob">{Math.round(plan.probability * 100)}%</span>
            </div>
            <div className="prob-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, plan.probability * 100)}%` }} />
            </div>
            <div className="plan-stints" aria-hidden="true">
              {plan.compounds.map((compound, i) => (
                <span key={`${compound}-${i}`} className={`plan-stint cmp-${compound}`}>
                  <span className="mono">{compound[0].toUpperCase()}</span>
                  {COMPOUND_NAME[compound]}
                </span>
              ))}
            </div>
            <div className="plan-meta mono">
              <span>{plan.stops === 0 ? "No stop" : `Pit L${plan.pitLaps.join(" / ")}`}</span>
              <span className={`risk-dot risk-${plan.risk}`}>{plan.risk} risk</span>
              <span>{plan.delta < 0.05 ? "fastest projection" : `+${plan.delta.toFixed(1)}s`}</span>
            </div>
            {plan.notes[0] ? <p className="plan-note">{plan.notes[0]}</p> : null}
          </article>
        ))}
      </div>

      <div className="forecast-body">
        <div className="panel ai-panel">
          <div className="panel-head">
            <h3>The desk&apos;s read</h3>
            <span className={`mono ai-tag${read?.source === "ai" ? " is-live" : ""}`}>
              {read?.source === "ai" ? `AI · ${read.model}` : "model only"}
            </span>
          </div>
          <p className="ai-read">
            {read
              ? read.text
              : "Ask for the pre-weekend read: why the model likes the front-running plan, what the alternatives give up, and the one race event that would flip it."}
          </p>
          <button type="button" className="btn btn-ghost ai-btn" onClick={askDesk} disabled={reading}>
            {reading ? "Reading the forecast…" : read ? "Read it again" : "Ask the desk"}
          </button>
        </div>

        <div className="panel forecast-assumptions">
          <div className="panel-head">
            <h3>What is priced in</h3>
            <span className="mono">no black box</span>
          </div>
          <ul>
            {forecast.assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              Plans are grouped by shape — one stop, medium to hard — so the percentage is the share
              of scenarios that pick that shape, not a bookmaker&apos;s price.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
