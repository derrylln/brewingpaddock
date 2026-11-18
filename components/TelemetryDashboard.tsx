"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AiRead } from "@/lib/ai";
import { fmtGap, fmtLap } from "@/lib/format";
import type { DriverOption, SessionOption } from "@/lib/openf1";
import { alignLaps, type TelemetryPayload } from "@/lib/telemetry";

const W = 1000;
const H = 556;
const PAD = { left: 46, right: 18, top: 18 };
const SPEED = { y: 18, h: 208 };
const PEDAL = { y: 262, h: 92 };
const DELTA = { y: 392, h: 118 };

type Selection = { session: number; a: number; lapA: number; b: number; lapB: number };

function path(values: number[], x: (index: number) => number, y: (value: number) => number): string {
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
}

function fastest(driver: DriverOption) {
  return driver.laps.reduce((best, lap) => (lap.time < best.time ? lap : best), driver.laps[0]);
}

/** When the picker's own feed is throttled, the pair we already have still works. */
function driversFromPayload(payload: TelemetryPayload): DriverOption[] {
  return payload.drivers.map((driver) => ({
    number: driver.number,
    code: driver.code,
    name: driver.name,
    team: driver.team,
    colour: driver.colour,
    laps: [{ lap: driver.lapNumber, time: driver.lapTime }],
  }));
}

function sessionLabel(session: SessionOption): string {
  const when = new Date(session.date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
  return `${session.circuit} · ${session.name} · ${when}`;
}

export default function TelemetryDashboard() {
  const [payload, setPayload] = useState<TelemetryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);

  const [hover, setHover] = useState<number | null>(null);
  const [showBrake, setShowBrake] = useState(true);
  const [read, setRead] = useState<AiRead | null>(null);
  const [reading, setReading] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const signature = useRef<string>("");

  /** Driver lists for a session; the pair defaults to the two quickest laps. */
  const loadDrivers = useCallback(async (sessionKey: number): Promise<DriverOption[]> => {
    const res = await fetch(`/api/telemetry/options?session=${sessionKey}`);
    if (!res.ok) throw new Error("Driver list unavailable.");
    const data = (await res.json()) as { options: DriverOption[] };
    const list = data.options.filter((driver) => driver.laps.length > 0);
    if (list.length === 0) throw new Error("No clean laps in that session.");
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pairRes, sessionRes] = await Promise.all([
          fetch("/api/telemetry"),
          fetch("/api/telemetry/options"),
        ]);
        if (!pairRes.ok) throw new Error("Telemetry feed unavailable.");
        const pair = (await pairRes.json()) as TelemetryPayload;
        if (!alive) return;
        setPayload(pair);

        if (sessionRes.ok) {
          const list = (await sessionRes.json()) as { options: SessionOption[] };
          if (alive && list.options.length > 0) setSessions(list.options);
          else if (alive) {
            setSessions([
              {
                key: pair.session.sessionKey,
                name: pair.session.name,
                type: "Race",
                circuit: pair.session.circuit,
                country: pair.session.country,
                date: pair.session.date,
                year: pair.session.year,
              },
            ]);
          }
        }

        const key = pair.session.sessionKey;
        let list: DriverOption[];
        try {
          list = await loadDrivers(key);
        } catch {
          // OpenF1 throttled the driver list: the bundled pair is still a real view.
          list = driversFromPayload(pair);
        }
        if (!alive) return;
        setDrivers(list);
        const [a, b] = pair.drivers;
        setSelection({
          session: key,
          a: a.number,
          lapA: a.lapNumber,
          b: b.number,
          lapB: b.lapNumber,
        });
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadDrivers]);

  useEffect(() => {
    if (!selection) return;
    const key = `${selection.session}:${selection.a}:${selection.lapA}:${selection.b}:${selection.lapB}`;
    if (key === signature.current) return;
    signature.current = key;

    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      session: String(selection.session),
      a: String(selection.a),
      lapA: String(selection.lapA),
      b: String(selection.b),
      lapB: String(selection.lapB),
    });

    fetch(`/api/telemetry?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Those laps did not come back.");
        }
        return res.json() as Promise<TelemetryPayload>;
      })
      .then((next) => {
        if (!alive) return;
        setPayload(next);
        setRead(null);
      })
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [selection]);

  // A read describes one comparison, so drop it when the comparison moves.
  useEffect(() => {
    setRead(null);
  }, [selection?.a, selection?.lapA, selection?.b, selection?.lapB, selection?.session]);

  const comparison = useMemo(() => {
    if (!payload) return null;
    return alignLaps(payload.drivers[0], payload.drivers[1]);
  }, [payload]);

  const changeSession = async (key: number) => {
    setError(null);
    try {
      const list = await loadDrivers(key);
      setDrivers(list);
      const [first, second] = list;
      const lapFirst = fastest(first);
      const lapSecond = fastest(second ?? first);
      setSelection({
        session: key,
        a: first.number,
        lapA: lapFirst.lap,
        b: (second ?? first).number,
        lapB: lapSecond.lap,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const changeDriver = (side: "a" | "b", number: number) => {
    if (!selection) return;
    const driver = drivers.find((entry) => entry.number === number);
    if (!driver) return;
    const lap = fastest(driver);
    setSelection(
      side === "a"
        ? { ...selection, a: number, lapA: lap.lap }
        : { ...selection, b: number, lapB: lap.lap },
    );
  };

  const fastestPair = () => {
    if (!selection || drivers.length < 2) return;
    const ranked = [...drivers].sort((x, y) => fastest(x).time - fastest(y).time);
    setSelection({
      ...selection,
      a: ranked[0].number,
      lapA: fastest(ranked[0]).lap,
      b: ranked[1].number,
      lapB: fastest(ranked[1]).lap,
    });
  };

  const retry = () => {
    signature.current = "";
    if (selection) setSelection({ ...selection });
  };

  const askEngineer = async () => {
    if (!selection) return;
    setReading(true);
    try {
      const res = await fetch("/api/ai/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      if (!res.ok) throw new Error("offline");
      const data = (await res.json()) as { read: AiRead };
      setRead(data.read);
    } catch {
      setRead(null);
    } finally {
      setReading(false);
    }
  };

  if (error && !payload) {
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

  if (!payload || !comparison || !selection) {
    return (
      <div className="panel telemetry-loading">
        <div className="sk-line w40" />
        <div className="chart-skeleton" />
        <p className="mono">Pulling the fastest laps from OpenF1…</p>
      </div>
    );
  }

  const [a, b] = payload.drivers;
  const { grid, length, maxSpeed, delta } = comparison;
  const speedMax = Math.max(300, Math.ceil((maxSpeed + 20) / 50) * 50);
  const x = (index: number) => PAD.left + (grid[index] / length) * (W - PAD.left - PAD.right);
  const speedY = (value: number) => SPEED.y + SPEED.h - (value / speedMax) * SPEED.h;
  const pedalY = (value: number) => PEDAL.y + PEDAL.h - (value / 100) * PEDAL.h;
  const maxAbs = Math.max(0.12, ...delta.map((value) => Math.abs(value)));
  const midDelta = DELTA.y + DELTA.h / 2;
  const deltaY = (value: number) => midDelta - (value / maxAbs) * (DELTA.h / 2 - 10);

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

  const driverSelect = (side: "a" | "b") => {
    const number = side === "a" ? selection.a : selection.b;
    const lapNumber = side === "a" ? selection.lapA : selection.lapB;
    const driver = drivers.find((entry) => entry.number === number) ?? drivers[0];
    return (
      <div className={`tg-pick tg-pick-${side}`} style={{ "--team": driver?.colour ?? "#888" } as CSSProperties}>
        <span className="mono field-label">{side === "a" ? "Driver A" : "Driver B"}</span>
        <select
          className="input"
          value={number}
          onChange={(event) => changeDriver(side, Number(event.target.value))}
          aria-label={side === "a" ? "Driver A" : "Driver B"}
        >
          {drivers.map((entry) => (
            <option key={entry.number} value={entry.number}>
              {entry.code} · {entry.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={lapNumber}
          onChange={(event) =>
            setSelection(
              side === "a"
                ? { ...selection, lapA: Number(event.target.value) }
                : { ...selection, lapB: Number(event.target.value) },
            )
          }
          aria-label={side === "a" ? "Lap for driver A" : "Lap for driver B"}
        >
          {driver?.laps.map((lap) => (
            <option key={lap.lap} value={lap.lap}>
              Lap {lap.lap} · {fmtLap(lap.time)}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="telemetry">
      <div className="tg-picker">
        <label className="tg-pick tg-pick-session">
          <span className="mono field-label">Session</span>
          <select
            className="input"
            value={selection.session}
            onChange={(event) => changeSession(Number(event.target.value))}
            aria-label="Session"
          >
            {sessions.map((session) => (
              <option key={session.key} value={session.key}>
                {sessionLabel(session)}
              </option>
            ))}
          </select>
        </label>
        {driverSelect("a")}
        {driverSelect("b")}
        <div className="tg-picker-actions">
          <button type="button" className="btn btn-ghost" onClick={fastestPair}>
            Fastest pair
          </button>
          <span className={`source-badge ${payload.source === "live" ? "is-live" : ""}`}>
            <span className="live-dot" />
            {payload.source === "live" ? "Live OpenF1" : "Bundled pair"}
          </span>
        </div>
      </div>

      {error ? (
        <div className="tg-error">
          <span className="mono">{error}</span>
          <button type="button" className="mono tg-retry" onClick={retry}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="telemetry-head">
        <div className="telemetry-session">
          {loading ? <span className="mono telemetry-sub">Loading those laps…</span> : null}
          <h2 className="telemetry-title">
            {payload.session.year} {payload.session.circuit} · {payload.session.name}
          </h2>
          <p className="mono telemetry-sub">
            {a.code} lap {a.lapNumber} vs {b.code} lap {b.lapNumber} · session{" "}
            {payload.session.sessionKey} ·{" "}
            {new Date(payload.session.date).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="telemetry-legend">
          {[a, b].map((driver) => (
            <div className="legend-row" key={`${driver.number}-${driver.lapNumber}`} style={{ "--team": driver.colour } as CSSProperties}>
              <span className="legend-swatch" />
              <span className="legend-code mono">{driver.code}</span>
              <span className="legend-team">
                {driver.team} · L{driver.lapNumber}
              </span>
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
              key={`${driver.number}-${driver.lapNumber}`}
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
                <span>{isFaster ? "+0.000 faster" : fmtGap(comparison.lapDelta)}</span>
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
            <span className="mono hud-label">
              {a.code} vs {b.code}
            </span>
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
          aria-label={`Speed, pedal and delta traces for ${a.code} lap ${a.lapNumber} and ${b.code} lap ${b.lapNumber}`}
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
                <line x1={px} y1={SPEED.y} x2={px} y2={DELTA.y + DELTA.h} stroke="rgba(255,255,255,0.05)" />
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
            DELTA · {a.code} L{a.lapNumber} VS {b.code} L{b.lapNumber} · SECONDS
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
        <p className="mono telemetry-source">{payload.note}</p>
      </div>

      <div className="panel ai-panel">
        <div className="panel-head">
          <h3>The engineer&apos;s read</h3>
          <span className={`mono ai-tag${read?.source === "ai" ? " is-live" : ""}`}>
            {read?.source === "ai" ? `AI · ${read.model}` : "model only"}
          </span>
        </div>
        <p className="ai-read">
          {read
            ? read.text
            : `Ask for the read on ${a.code} lap ${a.lapNumber} against ${b.code} lap ${b.lapNumber}: where the time went, what the throttle and braking traces say, and which part of the lap decides it if they race.`}
        </p>
        <button type="button" className="btn btn-ghost ai-btn" onClick={askEngineer} disabled={reading}>
          {reading ? "Reading the laps…" : read ? "Read it again" : "Ask the engineer"}
        </button>
      </div>
    </div>
  );
}
