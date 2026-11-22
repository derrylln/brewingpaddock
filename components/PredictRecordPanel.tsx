"use client";

import { useEffect, useState } from "react";
import type { PredictRecord } from "@/lib/predict-record";

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

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * The predictor's record. Frozen rankings are history; older rounds are the
 * model replayed on the state of the time, and each row is labelled with which.
 */
export default function PredictRecordPanel() {
  const [record, setRecord] = useState<PredictRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/predict/record")
      .then((res) => {
        if (!res.ok) throw new Error("The record is unavailable.");
        return res.json() as Promise<PredictRecord>;
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
          <p className="mono">Scoring the model against the classifications…</p>
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
          <h2 className="record-title">Does the model know the order?</h2>
          <p className="mono record-sub">
            {record.season} · last {record.rows.length} completed rounds · {record.saved} saved,{" "}
            {record.replayed} replay
          </p>
        </div>
        {record.scored > 0 ? (
          <div className="record-stats">
            <div>
              <span className="mono label">Winner in top three</span>
              <strong className="mono">
                {record.winnerTop3}/{record.scored}
              </strong>
            </div>
            <div>
              <span className="mono label">Podium hit rate</span>
              <strong className="mono">{pct(record.podiumRate)}</strong>
            </div>
            <div>
              <span className="mono label">Top ten hit rate</span>
              <strong className="mono">{pct(record.top10Rate)}</strong>
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
              — {record.locked.ranking.slice(0, 3).map((row) => row.code).join(" · ")}
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
          <span className="mono">frozen ranking, or replay, vs the classification</span>
        </div>
        {record.rows.length === 0 ? (
          <p className="record-note">
            No completed round has a classification yet. The first saved ranking above is scored
            when its race finishes.
          </p>
        ) : (
          <div className="record-table">
            <div className="record-row record-row-head mono">
              <span>Race</span>
              <span>Model&apos;s top three</span>
              <span>Actual podium</span>
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
                  <span className="mono">{row.predicted.join(" · ")}</span>
                </div>
                <div className="record-cell">
                  <span className="mono">{row.actual.join(" · ")}</span>
                </div>
                <div className="record-cell">
                  <span className={`mono record-verdict${row.winnerCalled ? " is-hit" : " is-miss"}`}>
                    {row.winnerCalled
                      ? "winner called"
                      : row.winnerInTop3
                        ? "winner in top three"
                        : "winner missed"}
                  </span>
                  <span className="mono record-dim">
                    {row.podiumHits}/3 podium · {row.top10Hits}/10 points
                  </span>
                  <span
                    className={`mono record-src${row.source === "saved" ? " is-saved" : ""}`}
                  >
                    {row.source === "saved" ? "saved pre-race" : "replay"}
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
