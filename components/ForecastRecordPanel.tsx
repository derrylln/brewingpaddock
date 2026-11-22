"use client";

import { useEffect, useState } from "react";
import type { ForecastRecord } from "@/lib/forecast-record";

function day(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function stopsLabel(count: number): string {
  return count === 1 ? "1 stop" : `${count} stops`;
}

/**
 * How the forecast actually did. The panel is deliberately blunt about what it
 * is: the model rerun on the completed rounds, not a stored pre-race call, so a
 * tune to the model rewrites this table too.
 */
export default function ForecastRecordPanel() {
  const [record, setRecord] = useState<ForecastRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/strategy/record")
      .then((res) => {
        if (!res.ok) throw new Error("The record is unavailable.");
        return res.json() as Promise<ForecastRecord>;
      })
      .then((data) => alive && setRecord(data))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return null;
  if (!record) {
    return (
      <section className="record">
        <div className="panel forecast-loading">
          <div className="sk-line w40" />
          <div className="sk-line w70" />
          <p className="mono">Rerunning the forecast on the completed rounds…</p>
        </div>
      </section>
    );
  }

  if (record.rows.length === 0) return null;

  return (
    <section className="record">
      <div className="record-head">
        <div>
          <p className="mono kicker-red">Backtest</p>
          <h2 className="record-title">Did the call hold up?</h2>
          <p className="mono record-sub">
            {record.season} · last {record.rows.length} completed rounds
          </p>
        </div>
        <div className="record-stats">
          <div>
            <span className="mono label">Stop call matched</span>
            <strong className="mono">
              {record.stopsHits}/{record.scored}
            </strong>
          </div>
          <div>
            <span className="mono label">Pit window error</span>
            <strong className="mono">
              {record.meanPitError === null ? "—" : `±${record.meanPitError.toFixed(1)} laps`}
            </strong>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Race by race</h3>
          <span className="mono">predicted favourite vs the pit log</span>
        </div>
        <div className="record-table">
          <div className="record-row record-row-head mono">
            <span>Race</span>
            <span>Forecast favourite</span>
            <span>What happened</span>
            <span>Verdict</span>
          </div>
          {record.rows.map((row) => (
            <div className="record-row" key={row.round}>
              <div className="record-race">
                <span className="mono record-round">R{row.round}</span>
                <strong>{row.raceName}</strong>
                <span className="mono record-dim">{day(row.date)}</span>
              </div>
              <div className="record-cell">
                <span>{row.predicted.label}</span>
                <span className="mono record-dim">
                  {row.predicted.stops === 0
                    ? "no stop"
                    : `pit L${row.predicted.pitLaps.join(" / ")}`}{" "}
                  · {Math.round(row.predicted.probability * 100)}%
                </span>
              </div>
              <div className="record-cell">
                <span>
                  {row.winner} won on {stopsLabel(row.actual.winnerStops)}
                </span>
                <span className="mono record-dim">
                  top ten median {row.actual.fieldStops === null ? "—" : stopsLabel(row.actual.fieldStops)}
                  {row.actual.firstPitLap === null ? "" : ` · first stop L${row.actual.firstPitLap}`}
                </span>
              </div>
              <div className="record-cell">
                <span className={`mono record-verdict${row.stopsHit ? " is-hit" : " is-miss"}`}>
                  {row.stopsHit ? "stop call matched" : "different shape"}
                </span>
                <span className="mono record-dim">
                  {row.pitDelta === null
                    ? "no pit window"
                    : `window ${row.pitDelta > 0 ? "+" : ""}${row.pitDelta} laps`}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="record-note">{record.note}</p>
      </div>
    </section>
  );
}
