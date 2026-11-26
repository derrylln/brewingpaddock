"use client";

import { useEffect, useState } from "react";
import AiReadText from "@/components/AiReadText";
import type { AiRead } from "@/lib/ai";
import type { PapersNotes } from "@/lib/papers-notes";
import type { Prediction } from "@/lib/predict";
import { raceDay } from "@/lib/format";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const MINUTE = 60_000;

/**
 * How long to wait before asking the model again.
 *
 * The cadence is set by the budgets, not by impatience. Every poll is a function
 * invocation and two counted rate-limit windows on the visitor's AI bucket (6 a
 * minute, 30 an hour), so once a minute would spend an hour's allowance in
 * thirty minutes and then lock the visitor out of the read for the rest of it.
 *
 * Five minutes around qualifying (twelve an hour, 40% of the hourly bucket) and
 * fifteen minutes otherwise (four an hour) leave room for reloads and the other
 * AI panels. It also matches the server, which holds a board for five minutes:
 * polling faster would only re-read the same payload.
 */
function nextDelay(qualiAt: string | undefined, onThisWeekend: boolean): number {
  if (onThisWeekend) return 15 * MINUTE;
  const start = qualiAt ? Date.parse(qualiAt) : Number.NaN;
  if (Number.isFinite(start) && Date.now() >= start - 5 * MINUTE) return 5 * MINUTE;
  return 15 * MINUTE;
}

/**
 * A refused poll is a budget signal, not an outage: this route shares the
 * visitor's AI bucket, so retrying inside a minute would spend the window it was
 * refused by. Honour the wait the server asks for, within five to fifteen
 * minutes.
 */
function retryDelay(header: string | null): number {
  const asked = Number(header);
  if (Number.isFinite(asked) && asked > 0) {
    return Math.min(15, Math.max(5, Math.ceil(asked / 60))) * MINUTE;
  }
  return 5 * MINUTE;
}

export default function Predictor() {
  const [data, setData] = useState<(Prediction & { read?: AiRead; notes?: PapersNotes }) | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let loaded = false;

    async function tick() {
      let wait: number;
      try {
        const res = await fetch("/api/predict", { cache: "no-store" });
        if (!res.ok) {
          if (!loaded) setError("The model could not load the season data.");
          wait = retryDelay(res.headers.get("Retry-After"));
        } else {
          const payload = (await res.json()) as Prediction & {
            read?: AiRead;
            notes?: PapersNotes;
          };
          if (!alive) return;
          loaded = true;
          setData(payload);
          setError(null);
          wait = nextDelay(payload.race.qualiAt, payload.weekend.quali === "this-weekend");
        }
      } catch {
        if (!alive) return;
        // A refresh that fails never throws away a board already on screen.
        if (!loaded) setError("The model could not load the season data.");
        wait = 5 * MINUTE;
      }
      last = Date.now();
      schedule(wait);
    }

    function schedule(ms: number) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      // A background tab has no reader, so it stops polling and costs nothing
      // until it is looked at again; onVisible restarts the clock.
      if (!alive || document.visibilityState === "hidden") return;
      timer = setTimeout(tick, ms);
    }

    function onVisible() {
      // Refocusing is not a reason to poll: wait out the rest of the interval,
      // but never longer than the base one.
      if (document.visibilityState === "visible") {
        schedule(Math.max(0, MINUTE - (Date.now() - last)));
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    void tick();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (error) {
    return (
      <div className="panel empty-state">
        <p className="mono kicker-red">MODEL OFFLINE</p>
        <h3>No season data, no forecast.</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel telemetry-loading">
        <div className="sk-line w40" />
        <div className="sk-line w70" />
        <div className="chart-skeleton" />
        <p className="mono">Running the simulations…</p>
      </div>
    );
  }

  const top = data.rows.slice(0, 10);
  const podium = data.rows.slice(0, 3);
  const maxWin = Math.max(...data.rows.map((row) => row.win), 0.01);
  // Papers-first notes: only drivers whose weekend paperwork the desk has read.
  const fyi = new Map((data.notes?.items ?? []).map((note) => [note.code, note]));

  return (
    <div className="predict">
      <div className="predict-head">
        <div>
          <p className="mono kicker-red">Forecast</p>
          <h2 className="predict-title">{data.race.name}</h2>
          <p className="mono predict-sub">
            Round {data.race.round} · {data.race.circuit} · {raceDay(data.race.date)}
          </p>
          <p className="mono predict-sub">
            {data.weekend.quali === "this-weekend"
              ? "Qualifying: this weekend"
              : data.weekend.quali === "previous-round"
                ? "Qualifying: last round, this weekend's not run"
                : "Qualifying: none available"}
          </p>
        </div>
        <div className="predict-meta">
          <div>
            <span className="mono label">Simulations</span>
            <strong className="mono">{data.sims.toLocaleString("en-GB")}</strong>
          </div>
          <div>
            <span className="mono label">Result rows</span>
            <strong className="mono">{data.dataPoints}</strong>
          </div>
          <div>
            <span className="mono label">Drivers</span>
            <strong className="mono">{data.rows.length}</strong>
          </div>
        </div>
      </div>

      <div className="podium-cards">
        {podium.map((row, index) => (
          <div className="podium-card" key={row.code} style={{ borderTopColor: row.colour }}>
            <div className="podium-pos mono">P{index + 1}</div>
            <h3 className="podium-name">{row.name}</h3>
            <p className="podium-team">{row.team}</p>
            <div className="podium-prob mono">{pct(row.win)}</div>
            <div className="podium-sub mono">
              podium {pct(row.podium)} · points {pct(row.points)}
            </div>
          </div>
        ))}
      </div>

      {data.read ? (
        <div className="panel ai-panel">
          <div className="panel-head">
            <h3>The read</h3>
            <span className={`mono ai-tag${data.read.source === "ai" ? " is-live" : ""}`}>
              {data.read.source === "ai" ? `AI · ${data.read.model}` : "model only"}
            </span>
          </div>
          <AiReadText text={data.read.text} />
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Win probability</h3>
          <span className="mono">top ten · seeded Monte Carlo</span>
        </div>
        <div className="prob-list">
          {top.map((row, index) => (
            <div className="prob-row" key={row.code}>
              <span className="mono prob-rank">{String(index + 1).padStart(2, "0")}</span>
              <div className="prob-driver">
                <span className="prob-code mono" style={{ color: row.colour }}>
                  {row.code}
                </span>
                <span className="prob-name">{row.name}</span>
              </div>
              <div className="prob-bar">
                <span style={{ width: `${(row.win / maxWin) * 100}%`, background: row.colour }} />
              </div>
              <span className="mono prob-value">{pct(row.win)}</span>
              <span className="mono prob-extra">P3 {pct(row.podium)}</span>
              <span className="mono prob-extra">P10 {pct(row.points)}</span>
              {fyi.has(row.code) ? (
                <p className="prob-fyi">
                  <span
                    className="mono prob-fyi-tag"
                    title={
                      fyi.get(row.code)?.source === "ai"
                        ? `Read from this weekend's FIA papers by ${fyi.get(row.code)?.model}`
                        : "From this weekend's FIA papers"
                    }
                  >
                    FYI
                  </span>
                  <span>{fyi.get(row.code)?.text}</span>
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {fyi.size > 0 ? (
          <p className="factor-note">
            The FYI lines come from this weekend&apos;s FIA papers, read by the desk and followed up
            by {data.notes?.model ?? "the model"}. They annotate the grid — they are not an input to
            the simulation.
          </p>
        ) : null}
      </div>

      <div className="predict-split">
        <div className="panel">
          <div className="panel-head">
            <h3>Why the model likes them</h3>
            <span className="mono">factor weights</span>
          </div>
          <div className="factor-legend mono">
            <span>Qualifying 28%</span>
            <span>Form & Momentum 36%</span>
            <span>Team pace 14%</span>
            <span>Consistency 12%</span>
            <span>Championship 10%</span>
          </div>
          {top.slice(0, 5).map((row) => (
            <div className="factor-row" key={row.code}>
              <span className="mono factor-code">{row.code}</span>
              <div className="factor-bars">
                {row.factors.map((factor) => (
                  <span
                    key={factor.key}
                    className={`factor-bar factor-${factor.key}`}
                    style={{ flex: Math.max(0.06, factor.value) }}
                    title={`${factor.label}: ${(factor.value * 100).toFixed(0)}%`}
                  />
                ))}
              </div>
              <span className="mono factor-score">{(row.score * 100).toFixed(0)}</span>
            </div>
          ))}
          <p className="factor-note">
            Each bar is the normalised factor value. A driver with a small qualifying bar can still
            rank highly on form and championship weight.
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Sanity check</h3>
            <span className="mono">walk-forward backtest</span>
          </div>
          {data.backtest ? (
            <>
              <p className="backtest-copy">
                Ranked on the {data.backtest.rounds} rounds before the {data.backtest.raceName},
                with that race&apos;s grid standing in for qualifying. {data.backtest.hits} of 3
                predicted podium finishers matched the real result.
              </p>
              <div className="backtest-grid">
                <div>
                  <span className="mono label">Predicted</span>
                  {data.backtest.predicted.map((code, index) => (
                    <span
                      key={`p-${code}`}
                      className={`backtest-chip mono${data.backtest?.actual.includes(code) ? " is-hit" : ""}`}
                    >
                      P{index + 1} {code}
                    </span>
                  ))}
                </div>
                <div>
                  <span className="mono label">Actual</span>
                  {data.backtest.actual.map((code, index) => (
                    <span key={`a-${code}`} className="backtest-chip mono">
                      P{index + 1} {code}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="backtest-copy">No completed race available for a backtest yet.</p>
          )}
          <ul className="method-list">
            {data.method.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel disclaimer">
        <p className="mono kicker-red">Read this before you bet the farm</p>
        <p>
          This is a statistical model built on public classification data, not a prediction of what
          will happen. Its numbers know nothing about upgrades arriving at the track, weather,
          penalties or a first-lap incident — the FYI lines carry the paperwork, but they never move
          the probabilities. Use it to understand the shape of the grid, then watch the race.
        </p>
      </div>
    </div>
  );
}
