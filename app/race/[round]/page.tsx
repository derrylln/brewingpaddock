import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { debriefRead } from "@/lib/ai-reads";
import { buildDebrief } from "@/lib/debrief";
import { fmtLap, raceDay } from "@/lib/format";
import {
  getPitStops,
  getQualifying,
  getRaceResults,
  getSeasonOverview,
} from "@/lib/f1";
import { teamColour, teamName } from "@/lib/teams";

export const revalidate = 300;

type Props = { params: Promise<{ round: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { round } = await params;
  const overview = await getSeasonOverview();
  const race = overview.schedule.find((entry) => entry.round === round);
  return {
    title: race ? `${race.raceName} debrief` : "Race debrief",
    description: race
      ? `Automated debrief, full classification, pit stops and qualifying for the ${race.raceName}.`
      : undefined,
  };
}

function lapSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export default async function RacePage({ params }: Props) {
  const { round } = await params;
  const overview = await getSeasonOverview();
  const race = overview.schedule.find((entry) => entry.round === round);
  if (!race) notFound();

  const [results, quali, stops] = await Promise.all([
    getRaceResults(overview.season, race.round),
    getQualifying(overview.season, race.round),
    getPitStops(overview.season, race.round),
  ]);

  const debrief = results.length
    ? buildDebrief({ race, results, stops, quali, season: overview.season })
    : null;

  // Only the most recent round earns generated analysis: older rounds keep the
  // template copy, which keeps the cost of viewing a season archive at zero.
  const aiRead =
    debrief && race.round === overview.lastRace?.round
      ? await debriefRead(
          {
            raceName: race.raceName,
            headline: debrief.headline,
            deck: debrief.deck,
            stats: debrief.stats,
            paragraphs: debrief.paragraphs,
          },
          results.length,
        )
      : null;

  const index = overview.schedule.findIndex((entry) => entry.round === race.round);
  const prev = index > 0 ? overview.schedule[index - 1] : null;
  const next = index >= 0 && index < overview.schedule.length - 1 ? overview.schedule[index + 1] : null;

  const driverNames = new Map(results.map((row) => [row.Driver.driverId, row.Driver.familyName]));
  const fastestStops = [...stops]
    .sort((a, b) => Number(a.duration) - Number(b.duration))
    .slice(0, 8);
  const pole = quali[0];
  const poleTime = lapSeconds(pole?.Q3 ?? pole?.Q2 ?? pole?.Q1);

  return (
    <div className="page">
      <div className="shell">
        <div className="race-top">
          <Link href="/#championship" className="back-link mono">
            ← The desk
          </Link>
          <div className="race-nav mono">
            {prev ? <Link href={`/race/${prev.round}`}>← R{prev.round}</Link> : <span />}
            <span className="race-nav-current">Round {race.round}</span>
            {next ? <Link href={`/race/${next.round}`}>R{next.round} →</Link> : <span />}
          </div>
        </div>

        <header className="race-head">
          <p className="mono kicker-red">
            {overview.season} season · round {race.round} of {overview.schedule.length}
          </p>
          <h1 className="race-title">{race.raceName}</h1>
          <p className="race-sub">
            {race.Circuit.circuitName} · {race.Circuit.Location.locality},{" "}
            {race.Circuit.Location.country} · {raceDay(race.date)}
          </p>
          <div className="badge-row">
            <span className="badge mono">Grand Prix</span>
            {race.Sprint ? <span className="badge mono">Sprint weekend</span> : null}
            <span className="badge mono">{results.length} classified</span>
            <span className="badge mono">{stops.length} pit stops logged</span>
          </div>
        </header>

        {results.length === 0 ? (
          <div className="panel empty-state">
            <p className="mono kicker-red">CLASSIFICATION PENDING</p>
            <h3>No results for this round yet.</h3>
            <p>
              The race has not been classified, or the timing feed has not published it. The debrief
              generates itself the moment the data lands.
            </p>
            <Link className="btn btn-ghost" href="/predict">
              See the forecast
            </Link>
          </div>
        ) : (
          <>
            <div className="podium-grid">
              {results.slice(0, 3).map((row, slot) => (
                <div
                  key={row.Driver.driverId}
                  className={`podium-slot slot-${slot}`}
                  style={{ "--team": teamColour(row.Constructor.constructorId) } as CSSProperties}
                >
                  <div className="podium-pos mono">P{row.position}</div>
                  <div className="podium-driver">
                    <h3>
                      {row.Driver.givenName} {row.Driver.familyName}
                    </h3>
                    <p>{teamName(row.Constructor.constructorId, row.Constructor.name)}</p>
                  </div>
                  <div className="podium-meta mono">
                    <span>Grid P{row.grid}</span>
                    <span>{row.Time?.time ?? row.status}</span>
                    <span>{row.points} pts</span>
                  </div>
                </div>
              ))}
            </div>

            {debrief ? (
              <section className="debrief panel ticks">
                <div className="debrief-head">
                  <div>
                    <p className="mono kicker-red">Automated debrief</p>
                    <p className="debrief-note mono">
                      Generated from {results.length} classifications, {stops.length} pit stops and{" "}
                      {quali.length} qualifying laps
                    </p>
                  </div>
                  <div className="pipeline">
                    {debrief.pipeline.map((step) => (
                      <span className="pipeline-step mono" key={step}>
                        {step}
                      </span>
                    ))}
                  </div>
                </div>
                <h2 className="debrief-headline">{debrief.headline}</h2>
                <p className="debrief-deck">{debrief.deck}</p>

                <div className="debrief-stats">
                  {debrief.stats.map((stat) => (
                    <div className="debrief-stat" key={stat.label}>
                      <span className="mono label">{stat.label}</span>
                      <strong className="mono">{stat.value}</strong>
                      <span className="debrief-stat-note">{stat.note}</span>
                    </div>
                  ))}
                </div>

                <div className="debrief-body">
                  {debrief.paragraphs.map((paragraph, index) => (
                    <p key={index} className={index === 0 ? "lead" : undefined}>
                      {paragraph}
                    </p>
                  ))}
                </div>

                {aiRead ? (
                  <div className="debrief-ai">
                    <p className="mono kicker-red">
                      AI read {aiRead.model ? `· ${aiRead.model}` : null}
                    </p>
                    <p className="debrief-deck">{aiRead.text}</p>
                  </div>
                ) : null}

                <div className="tag-row">
                  {debrief.tags.map((tag) => (
                    <span className="tag mono" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="race-grid">
              <section className="panel">
                <div className="panel-head">
                  <h3>Classification</h3>
                  <span className="mono">all {results.length} runners</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table race-table">
                    <thead>
                      <tr>
                        <th>Pos</th>
                        <th>Driver</th>
                        <th>Team</th>
                        <th className="num">Grid</th>
                        <th className="num">Laps</th>
                        <th className="num">Time / status</th>
                        <th className="num">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row) => {
                        const gained = Number(row.grid) - Number(row.position);
                        return (
                          <tr
                            key={row.Driver.driverId}
                            style={{ "--team": teamColour(row.Constructor.constructorId) } as CSSProperties}
                          >
                            <td className="mono">{row.position}</td>
                            <td>
                              <div className="driver-cell">
                                <span className="driver-avatar mono">{row.Driver.code}</span>
                                <span className="driver-name">
                                  <strong>
                                    {row.Driver.givenName} {row.Driver.familyName}
                                  </strong>
                                  {row.FastestLap?.rank === "1" ? (
                                    <span className="fl-badge mono">FL {row.FastestLap.Time?.time}</span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                            <td className="team-cell">{teamName(row.Constructor.constructorId)}</td>
                            <td className="num mono">
                              {row.grid}
                              {Number(row.grid) > 0 ? (
                                <span className={`grid-delta ${gained > 0 ? "is-fast" : gained < 0 ? "is-slow" : ""}`}>
                                  {gained > 0 ? `▲${gained}` : gained < 0 ? `▼${Math.abs(gained)}` : "–"}
                                </span>
                              ) : null}
                            </td>
                            <td className="num mono">{row.laps}</td>
                            <td className="num mono">{row.Time?.time ?? row.status}</td>
                            <td className="num mono pts">{row.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="race-aside">
                <section className="panel">
                  <div className="panel-head">
                    <h3>Pit stops</h3>
                    <span className="mono">{stops.length} total</span>
                  </div>
                  <div className="pit-list">
                    {fastestStops.map((stop, index) => {
                      const seconds = Number(stop.duration);
                      return (
                        <div className="pit-row" key={`${stop.driverId}-${stop.stop}`}>
                          <span className="mono pit-rank">{String(index + 1).padStart(2, "0")}</span>
                          <span className="pit-driver">{driverNames.get(stop.driverId) ?? stop.driverId}</span>
                          <span className="mono pit-lap">L{stop.lap}</span>
                          <span className="pit-bar">
                            <span style={{ width: `${Math.min(100, (seconds / 6) * 100)}%` }} />
                          </span>
                          <span className="mono pit-time">{seconds.toFixed(1)}s</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="panel-note">
                    Quickest pit lanes of the race. Durations cover the in-lap, the stop and the
                    out-lap — not the stationary service alone.
                  </p>
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <h3>Qualifying</h3>
                    <span className="mono">
                      {pole ? `pole ${pole.Driver.code}` : "no data"}
                    </span>
                  </div>
                  <div className="q-list">
                    {quali.slice(0, 10).map((row) => {
                      const time = row.Q3 ?? row.Q2 ?? row.Q1;
                      const seconds = lapSeconds(time);
                      const gap = seconds && poleTime ? seconds - poleTime : null;
                      return (
                        <div className="q-row" key={row.Driver.driverId}>
                          <span className="mono q-pos">{row.position}</span>
                          <span className="q-driver">{row.Driver.familyName}</span>
                          <span className="mono q-time">{time ?? "—"}</span>
                          <span className={`mono q-gap ${gap && gap > 0 ? "is-slow" : ""}`}>
                            {gap === null ? "" : gap === 0 ? "pole" : `+${gap.toFixed(3)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="panel race-cta">
                  <p className="mono kicker-red">Telemetry</p>
                  <h3>See the fastest laps, not just the times.</h3>
                  <p>
                    Speed, throttle and delta traces for the quickest lap of the latest session.
                  </p>
                  <Link className="btn btn-ghost" href="/telemetry">
                    Compare laps
                  </Link>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
