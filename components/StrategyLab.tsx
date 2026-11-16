"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AiRead } from "@/lib/ai";
import {
  CIRCUITS,
  buildStrategies,
  type CircuitKey,
  type Compound,
  type Rain,
} from "@/lib/strategy";

const COMPOUNDS: Compound[] = ["soft", "medium", "hard", "inter", "wet"];
const COMPOUND_LABEL: Record<Compound, string> = {
  soft: "S",
  medium: "M",
  hard: "H",
  inter: "I",
  wet: "W",
};

const RAIN: Array<{ value: Rain; label: string }> = [
  { value: "dry", label: "Dry" },
  { value: "drying", label: "Drying" },
  { value: "light", label: "Light rain" },
  { value: "heavy", label: "Heavy rain" },
];

export default function StrategyLab() {
  const [circuit, setCircuit] = useState<CircuitKey>("interlagos");
  const profile = CIRCUITS[circuit];
  const [lap, setLap] = useState(24);
  const [compound, setCompound] = useState<Compound>("medium");
  const [tyreAge, setTyreAge] = useState(12);
  const [gapAhead, setGapAhead] = useState(1.2);
  const [gapBehind, setGapBehind] = useState(3.4);
  const [safetyCar, setSafetyCar] = useState(false);
  const [trackTemp, setTrackTemp] = useState(34);
  const [rain, setRain] = useState<Rain>("dry");
  const [read, setRead] = useState<AiRead | null>(null);
  const [reading, setReading] = useState(false);

  // A written read describes one scenario, so drop it the moment the scenario moves.
  useEffect(() => {
    setRead(null);
  }, [circuit, lap, compound, tyreAge, gapAhead, gapBehind, safetyCar, trackTemp, rain]);

  useEffect(() => {
    setLap(Math.round(profile.laps * 0.35));
  }, [profile.laps]);

  const safeLap = Math.min(lap, profile.laps - 2);

  const result = useMemo(
    () =>
      buildStrategies({
        circuit,
        lap: safeLap,
        totalLaps: profile.laps,
        compound,
        tyreAge,
        gapAhead,
        gapBehind,
        safetyCar,
        trackTemp,
        rain,
      }),
    [circuit, safeLap, profile.laps, compound, tyreAge, gapAhead, gapBehind, safetyCar, trackTemp, rain],
  );

  const best = result.options[0];
  const gain = result.baseline - best.totalTime;
  const remaining = Math.max(1, profile.laps - safeLap + 1);

  const askStrategist = async () => {
    setReading(true);
    try {
      const res = await fetch("/api/ai/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          circuit,
          lap: safeLap,
          compound,
          tyreAge,
          gapAhead,
          gapBehind,
          safetyCar,
          trackTemp,
          rain,
        }),
      });
      if (!res.ok) throw new Error("offline");
      const payload = (await res.json()) as { read: AiRead };
      setRead(payload.read);
    } catch {
      setRead({ text: result.call, source: "model", model: null });
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="lab">
      <div className="lab-grid">
        <div className="panel lab-form">
          <div className="panel-head">
            <h3>Race scenario</h3>
            <span className="mono">live model</span>
          </div>

          <label className="field">
            <span className="mono field-label">Circuit</span>
            <select
              className="input"
              value={circuit}
              onChange={(event) => setCircuit(event.target.value as CircuitKey)}
            >
              {Object.entries(CIRCUITS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.name} · {value.laps} laps
                </option>
              ))}
            </select>
            <span className="field-hint">{profile.note}</span>
          </label>

          <label className="field">
            <span className="mono field-label">
              Lap <em>{safeLap}</em>
            </span>
            <input
              className="range"
              type="range"
              min={2}
              max={profile.laps - 2}
              value={safeLap}
              onChange={(event) => setLap(Number(event.target.value))}
            />
            <span className="range-scale mono">
              <span>L2</span>
              <span>L{profile.laps}</span>
            </span>
          </label>

          <div className="field">
            <span className="mono field-label">Tyre on the car</span>
            <div className="compound-row">
              {COMPOUNDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`compound-btn cmp-${value}${compound === value ? " is-on" : ""}`}
                  onClick={() => setCompound(value)}
                  aria-label={value}
                >
                  {COMPOUND_LABEL[value]}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="mono field-label">
              Tyre age <em>{tyreAge} laps</em>
            </span>
            <input
              className="range"
              type="range"
              min={0}
              max={Math.min(45, safeLap)}
              value={Math.min(tyreAge, safeLap)}
              onChange={(event) => setTyreAge(Number(event.target.value))}
            />
          </label>

          <div className="field-pair">
            <label className="field">
              <span className="mono field-label">
                Gap ahead <em>{gapAhead.toFixed(1)}s</em>
              </span>
              <input
                className="range"
                type="range"
                min={0}
                max={12}
                step={0.1}
                value={gapAhead}
                onChange={(event) => setGapAhead(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="mono field-label">
                Gap behind <em>{gapBehind.toFixed(1)}s</em>
              </span>
              <input
                className="range"
                type="range"
                min={0}
                max={12}
                step={0.1}
                value={gapBehind}
                onChange={(event) => setGapBehind(Number(event.target.value))}
              />
            </label>
          </div>

          <label className="field">
            <span className="mono field-label">
              Track temperature <em>{trackTemp}°C</em>
            </span>
            <input
              className="range"
              type="range"
              min={8}
              max={56}
              value={trackTemp}
              onChange={(event) => setTrackTemp(Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span className="mono field-label">Weather</span>
            <select
              className="input"
              value={rain}
              onChange={(event) => setRain(event.target.value as Rain)}
            >
              {RAIN.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`sc-toggle${safetyCar ? " is-on" : ""}`}
            onClick={() => setSafetyCar((value) => !value)}
            aria-pressed={safetyCar}
          >
            <span className="sc-light" />
            <span>
              <strong>Safety car deployed</strong>
              <em>{safetyCar ? "Pit loss cut to roughly 40%" : "Green flag running"}</em>
            </span>
          </button>
        </div>

        <div className="lab-output">
          <div className="call-card ticks">
            <div className="call-head">
              <div>
                <p className="mono kicker-red">Engineer&apos;s call</p>
                <h3 className="call-title">{best.label}</h3>
              </div>
              <span className={`risk-pill risk-${best.risk}`}>{best.risk} risk</span>
            </div>
            <p className="call-copy">{result.call}</p>

            <div className="call-metrics">
              <div>
                <span className="mono label">Vs no further stop</span>
                <strong className={`mono ${gain >= 0 ? "is-fast" : "is-slow"}`}>
                  {gain >= 0 ? "−" : "+"}
                  {Math.abs(gain).toFixed(1)}s
                </strong>
              </div>
              <div>
                <span className="mono label">Stops</span>
                <strong className="mono">{best.stops}</strong>
              </div>
              <div>
                <span className="mono label">Race end</span>
                <strong className="mono">L{profile.laps}</strong>
              </div>
              <div>
                <span className="mono label">Undercut</span>
                <strong>{gapAhead < 1.5 ? "In range" : gapAhead < 3 ? "Coverable" : "Out of range"}</strong>
              </div>
            </div>

            <div className="stint-block">
              <div className="stint-labels mono">
                <span>Projected stint plan</span>
                <span>L{safeLap} → L{profile.laps}</span>
              </div>
              <div className="stint-timeline">
                {best.stints.map((stint, index) => {
                  const from = Math.max(stint.fromLap, safeLap);
                  const laps = Math.max(1, stint.toLap - from + 1);
                  const width = (laps / remaining) * 100;
                  return (
                    <div
                      key={`${stint.compound}-${stint.fromLap}-${index}`}
                      className={`stint-seg cmp-${stint.compound}`}
                      style={{ width: `${width}%` } as CSSProperties}
                      title={`${from}–${stint.toLap} on ${stint.compound}`}
                    >
                      {width > 9 ? <span className="mono">{COMPOUND_LABEL[stint.compound]} {laps}L</span> : null}
                    </div>
                  );
                })}
              </div>
              <div className="stint-scale mono">
                <span>L{safeLap}</span>
                <span>L{Math.round(safeLap + remaining / 2)}</span>
                <span>L{profile.laps}</span>
              </div>
            </div>

            {best.notes.length > 0 ? (
              <ul className="call-notes">
                {best.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="panel ai-panel">
            <div className="panel-head">
              <h3>The read</h3>
              <span className={`mono ai-tag${read?.source === "ai" ? " is-live" : ""}`}>
                {read?.source === "ai" ? `AI · ${read.model}` : "model only"}
              </span>
            </div>
            <p className="ai-read">
              {read
                ? read.text
                : "The simulator prices every window. Ask for the read and the desk will explain the call — why it wins, what it costs, and what should change it."}
            </p>
            <button
              type="button"
              className="btn btn-ghost ai-btn"
              onClick={askStrategist}
              disabled={reading}
            >
              {reading ? "Reading the call…" : read ? "Read it again" : "Ask the strategist"}
            </button>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Alternative windows</h3>
              <span className="mono">sorted by total race time</span>
            </div>
            <table className="data-table alt-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="num">Stops</th>
                  <th className="num">Δ best</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {result.options.slice(0, 7).map((option, index) => (
                  <tr key={option.id} className={index === 0 ? "is-best" : undefined}>
                    <td>{option.label}</td>
                    <td className="num mono">{option.stops}</td>
                    <td className="num mono">{index === 0 ? "—" : `+${option.delta.toFixed(1)}s`}</td>
                    <td>
                      <span className={`risk-dot risk-${option.risk}`}>{option.risk}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel radio-panel">
            <div className="panel-head">
              <h3>Team radio</h3>
              <span className="mono">simulated</span>
            </div>
            {result.transcript.map((line, index) => (
              <div className={`radio-line radio-${line.role}`} key={`${line.role}-${index}`}>
                <span className="mono radio-role">{line.role === "engineer" ? "ENG" : "DRV"}</span>
                <p>{line.text}</p>
              </div>
            ))}
            <p className="radio-undercut mono">{result.undercut}</p>
          </div>
        </div>
      </div>

      <div className="panel method-panel">
        <div className="panel-head">
          <h3>How the call is built</h3>
          <span className="mono">no black box</span>
        </div>
        <div className="method-grid">
          <div>
            <h4>Tyre model</h4>
            <p>
              Per-compound base offset and linear degradation, scaled by circuit abrasion and track
              temperature, with a cliff multiplier once a tyre passes its useful life.
            </p>
          </div>
          <div>
            <h4>Pit loss</h4>
            <p>
              Circuit-specific time lost in the pit lane plus a stationary stop, cut to roughly 40%
              under a safety car because the field is bunched.
            </p>
          </div>
          <div>
            <h4>Traffic & undercut</h4>
            <p>
              Rejoining behind a car within 2.2s costs an estimated 1.2s, and the gap ahead decides
              whether an undercut is live or needs covering.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
