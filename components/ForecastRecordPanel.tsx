"use client";

import { useEffect, useState } from "react";
import type { ForecastRecord } from "@/lib/forecast-record";

function day(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function stopsLabel(count: number): string {
  return count === 1 ? "1 stop" : `${count} stops`;
}

/**
 * How the forecast actually did. Rows saved before the race are frozen history;
 * older rounds are the model replayed, and the table marks which is which so the
 * record never quietly becomes a backtest.
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
          <p className="mono">Scoring the frozen calls against the pit log…</p>
        </div>
      </section>
    );
  }

  if (record.rows.length === 0 && !record.locked) return null;

  return (
    <section className="record">
      <div className="record-head">
        <div>
          <p className="mono kicker-red">Track record</p>
          <h2 className="record-title">Did the call hold up?</h2>
          <p className="mono record-sub">
            {record.season} · last {record.rows.length} completed rounds · {record.saved} saved,{" "}
            {record.replayed} replay
          </p>
        </div>
        {record.scored > 0 ? (
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
            <div>
              <span className="mono label">Frozen before the flag</span>
              <strong className="mono">
                {record.saved}/{record.scored}
              </strong>
            </div>
          </div>
        ) : null}
      </div>

      {record.locked ? (
        <div className="record-lock">
          <div>
            <span className="mono label">Locked in</span>
            <p>
              <strong>
                R{record.locked.round} · {record.locked.raceName}
              </strong>{" "}
              {record.locked.favourite.stops === 0
                ? "— no stop"
                : `— ${record.locked.favourite.label}, pit L${record.locked.favourite.pitLaps.join(
                    " / ",
                  )}`}{" "}
              at {Math.round(record.locked.favourite.probability * 100)}%
            </p>
          </div>
          <span className="mono record-dim">
            saved {stamp(record.locked.savedAt)} · scoring after {day(record.locked.date)}
          </span>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Race by race</h3>
          <span className="mono">frozen call, or replay, vs the pit log</span>
        </div>
        {record.rows.length === 0 ? (
          <p className="record-note">
            No completed round has a pit log yet. The first saved call above is scored when its
            race finishes.
          </p>
        ) : (
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
                    top ten median{" "}
                    {row.actual.fieldStops === null ? "—" : stopsLabel(row.actual.fieldStops)}
                    {row.actual.firstPitLap === null
                      ? ""
                      : ` · first stop L${row.actual.firstPitLap}`}
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
                  <span
                    className={`mono record-src${row.predicted.source === "saved" ? " is-saved" : ""}`}
                  >
                    {row.predicted.source === "saved" ? "saved pre-race" : "replay"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="record-note">{record.note}</p>
      </div>
    </section>
  );
}
