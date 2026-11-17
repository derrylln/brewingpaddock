"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fmtGap, fmtLap } from "@/lib/format";
import { alignLaps, type TelemetryPayload } from "@/lib/telemetry";

const W = 1000;
const H = 556;
const PAD = { left: 46, right: 18, top: 18 };
const SPEED = { y: 18, h: 208 };
const PEDAL = { y: 262, h: 92 };
const DELTA = { y: 392, h: 118 };

function path(values: number[], x: (index: number) => number, y: (value: number) => number): string {
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
}

export default function TelemetryDashboard() {
  const [data, setData] = useState<TelemetryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showBrake, setShowBrake] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/telemetry")
      .then((res) => {
        if (!res.ok) throw new Error("Telemetry feed unavailable.");
        return res.json() as Promise<TelemetryPayload>;
      })
      .then((payload) => alive && setData(payload))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  const comparison = useMemo(() => {
    if (!data) return null;
    return alignLaps(data.drivers[0], data.drivers[1]);
  }, [data]);

  if (error) {
    return (
      <div className="panel empty-state">
        <p className="mono kicker-red">TELEMETRY OFFLINE</p>
        <h3>The car data did not arrive.</h3>
        <p>{error}</p>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (!data || !comparison) {
    return (
      <div className="panel telemetry-loading">
        <div className="sk-line w40" />
        <div className="chart-skeleton" />
        <p className="mono">Pulling the fastest laps from OpenF1…</p>
      </div>
    );
  }

  const [a, b] = data.drivers;
  const { grid, length, maxSpeed, delta } = comparison;
  const speedMax = Math.max(300, Math.ceil((maxSpeed + 20) / 50) * 50);
  const x = (index: number) =>
    PAD.left + (grid[index] / length) * (W - PAD.left - PAD.right);
  const speedY = (value: number) => SPEED.y + SPEED.h - (value / speedMax) * SPEED.h;
  const pedalY = (value: number) => PEDAL.y + PEDAL.h - (value / 100) * PEDAL.h;
  const maxAbs = Math.max(0.12, ...delta.map((value) => Math.abs(value)));
  const midDelta = DELTA.y + DELTA.h / 2;
  const deltaY = (value: number) =>
    midDelta - (value / maxAbs) * (DELTA.h / 2 - 10);

  const activeIndex = hover ?? Math.floor(grid.length * 0.58);
  const activeX = x(activeIndex);
  const deltaArea = `${path(delta, x, deltaY)} L${x(delta.length - 1).toFixed(1)},${midDelta} L${x(
    0,
  ).toFixed(1)},${midDelta} Z`;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
    const index = Math.round(Math.min(1, Math.max(0, ratio)) * (grid.length - 1));
    setHover(index);
  };

  const faster = comparison.lapDelta <= 0 ? a : b;
  const slower = faster === a ? b : a;

  return (
    <div className="telemetry">
      <div className="telemetry-head">
        <div className="telemetry-session">
          <span className={`source-badge ${data.source === "live" ? "is-live" : ""}`}>
            <span className="live-dot" />
            {data.source === "live" ? "Live OpenF1" : "Cached session"}
          </span>
          <h2 className="telemetry-title">
            {data.session.year} {data.session.circuit} · {data.session.name}
          </h2>
          <p className="mono telemetry-sub">
            Fastest lap per driver · session {data.session.sessionKey} ·{" "}
            {new Date(data.session.date).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="telemetry-legend">
          {[a, b].map((driver) => (
            <div className="legend-row" key={driver.number} style={{ "--team": driver.colour } as CSSProperties}>
              <span className="legend-swatch" />
              <span className="legend-code mono">{driver.code}</span>
              <span className="legend-team">{driver.team}</span>
              <span className="legend-lap mono">{fmtLap(driver.lapTime)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="driver-cards">
        {[a, b].map((driver) => {
          const isFaster = driver === faster;
          return (
            <div
              key={driver.number}
              className={`driver-card${isFaster ? " is-faster" : ""}`}
              style={{ "--team": driver.colour } as CSSProperties}
            >
              <div className="driver-card-top">
                <div>
                  <span className="mono driver-card-code">{driver.code}</span>
                  <p className="driver-card-name">{driver.name}</p>
                </div>
                <span className="mono driver-card-lap">{fmtLap(driver.lapTime)}</span>
              </div>
              <div className="driver-card-meta mono">
                <span>Lap {driver.lapNumber}</span>
                <span>{driver.team}</span>
                <span>{isFaster ? `+0.000 faster` : fmtGap(comparison.lapDelta)}</span>
              </div>
              <div className="sector-grid">
                {driver.sectors.map((sector, index) => {
                  const opponent = driver === a ? b : a;
                  const diff = sector - opponent.sectors[index];
                  return (
                    <div className="sector-cell" key={index}>
                      <span className="mono sector-label">S{index + 1}</span>
                      <span className="mono sector-time">{sector.toFixed(3)}</span>
                      <span className={`mono sector-diff ${diff < 0 ? "is-fast" : diff > 0 ? "is-slow" : ""}`}>
                        {diff === 0 ? "=" : fmtGap(diff)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="chart-shell">
        <div className="chart-hud">
          <div className="hud-cell">
            <span className="mono hud-label">Distance</span>
            <strong className="mono">{Math.round(grid[activeIndex])} m</strong>
          </div>
          <div className="hud-cell" style={{ "--team": a.colour } as CSSProperties}>
            <span className="mono hud-label">{a.code} speed</span>
            <strong className="mono">{Math.round(comparison.a.v[activeIndex])} km/h</strong>
          </div>
          <div className="hud-cell" style={{ "--team": b.colour } as CSSProperties}>
            <span className="mono hud-label">{b.code} speed</span>
            <strong className="mono">{Math.round(comparison.b.v[activeIndex])} km/h</strong>
          </div>
          <div className="hud-cell">
            <span className="mono hud-label">{a.code} vs {b.code}</span>
            <strong className={`mono ${delta[activeIndex] <= 0 ? "is-fast" : "is-slow"}`}>
              {fmtGap(delta[activeIndex])}
            </strong>
          </div>
          <button
            type="button"
            className={`chip chart-toggle${showBrake ? " is-on" : ""}`}
            onClick={() => setShowBrake((value) => !value)}
          >
            Brake trace
          </button>
        </div>

        <svg
          ref={svgRef}
          className="telemetry-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Speed, pedal and delta traces for ${a.code} and ${b.code}`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="deltaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#37D67A" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#37D67A" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="deltaFillNeg" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#E10600" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#E10600" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[100, 200, 300].filter((value) => value < speedMax).map((value) => (
            <line
              key={value}
              x1={PAD.left}
              y1={speedY(value)}
              x2={W - PAD.right}
              y2={speedY(value)}
              stroke="rgba(255,255,255,0.07)"
              strokeDasharray="3 6"
            />
          ))}
          {[100, 200, 300].filter((value) => value < speedMax).map((value) => (
            <text
              key={`label-${value}`}
              x={PAD.left - 8}
              y={speedY(value) + 3}
              textAnchor="end"
              className="chart-axis"
            >
              {value}
            </text>
          ))}

          {Array.from({ length: Math.floor(length / 500) + 1 }, (_, i) => i * 500).map((metres) => {
            const px = PAD.left + (metres / length) * (W - PAD.left - PAD.right);
            return (
              <g key={metres}>
                <line
                  x1={px}
                  y1={SPEED.y}
                  x2={px}
                  y2={DELTA.y + DELTA.h}
                  stroke="rgba(255,255,255,0.05)"
                />
                <text x={px} y={H - 10} textAnchor="middle" className="chart-axis">
                  {metres}m
                </text>
              </g>
            );
          })}

          <text x={PAD.left} y={SPEED.y - 6} className="chart-panel-label">
            SPEED · KM/H
          </text>
          <text x={PAD.left} y={PEDAL.y - 8} className="chart-panel-label">
            THROTTLE / BRAKE · %
          </text>
          <text x={PAD.left} y={DELTA.y - 8} className="chart-panel-label">
            DELTA · {a.code} VS {b.code} · SECONDS
          </text>

          <path d={path(comparison.a.v, x, speedY)} fill="none" stroke={a.colour} strokeWidth="2.2" />
          <path d={path(comparison.b.v, x, speedY)} fill="none" stroke={b.colour} strokeWidth="2.2" />

          <path d={path(comparison.a.th, x, pedalY)} fill="none" stroke={a.colour} strokeWidth="1.6" opacity="0.95" />
          <path d={path(comparison.b.th, x, pedalY)} fill="none" stroke={b.colour} strokeWidth="1.6" opacity="0.95" />
          {showBrake ? (
            <>
              <path d={path(comparison.a.br, x, pedalY)} fill="none" stroke={a.colour} strokeWidth="1.1" strokeDasharray="2 3" opacity="0.6" />
              <path d={path(comparison.b.br, x, pedalY)} fill="none" stroke={b.colour} strokeWidth="1.1" strokeDasharray="2 3" opacity="0.6" />
            </>
          ) : null}

          <line x1={PAD.left} y1={midDelta} x2={W - PAD.right} y2={midDelta} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 5" />
          <path d={deltaArea} fill={delta[delta.length - 1] <= 0 ? "url(#deltaFill)" : "url(#deltaFillNeg)"} />
          <path d={path(delta, x, deltaY)} fill="none" stroke={delta[delta.length - 1] <= 0 ? "#37D67A" : "#FF4A3D"} strokeWidth="1.8" />

          <line
            x1={activeX}
            y1={SPEED.y}
            x2={activeX}
            y2={DELTA.y + DELTA.h}
            stroke="rgba(244,243,239,0.35)"
            strokeDasharray="3 3"
          />
          <circle cx={activeX} cy={speedY(comparison.a.v[activeIndex])} r="3.5" fill={a.colour} stroke="var(--bg)" strokeWidth="1.5" />
          <circle cx={activeX} cy={speedY(comparison.b.v[activeIndex])} r="3.5" fill={b.colour} stroke="var(--bg)" strokeWidth="1.5" />
        </svg>
      </div>

      <div className="telemetry-foot">
        <div>
          <p className="mono kicker-red">How to read it</p>
          <p className="telemetry-note">
            Both laps are interpolated onto a shared distance grid, so the traces line up corner by
            corner. The delta panel is elapsed time relative to the start of the lap: below the line
            means <strong>{faster.code}</strong> is gaining, above means <strong>{slower.code}</strong> is.
            Official lap time difference: <strong className="mono">{fmtGap(comparison.lapDelta)}</strong>.
          </p>
        </div>
        <p className="mono telemetry-source">{data.note}</p>
      </div>
    </div>
  );
}
