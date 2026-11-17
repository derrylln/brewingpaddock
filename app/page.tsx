import Link from "next/link";
import Countdown from "@/components/Countdown";
import HeroTrace from "@/components/HeroTrace";
import InstagramCoverflow from "@/components/InstagramCoverflow";
import ModulesGrid from "@/components/ModulesGrid";
import NewsFeed from "@/components/NewsFeed";
import SectionHead from "@/components/SectionHead";
import StandingsTable from "@/components/StandingsTable";
import { daysUntil, raceDay } from "@/lib/format";
import { getSeasonOverview } from "@/lib/f1";
import { getInstagramPosts, instagramHandle, instagramUrl } from "@/lib/instagram";
import { teamColour, teamName } from "@/lib/teams";

export const revalidate = 300;

export default async function HomePage() {
  const overview = await getSeasonOverview();
  const igPosts = await getInstagramPosts();
  const { standings, constructors, nextRace, lastRace, lastPodium, schedule, season } = overview;
  const leader = standings[0];
  const rival = standings[1];
  const gap = leader && rival ? leader.points - rival.points : 0;
  const remaining = schedule.length - overview.completedRounds;
  const clinched = gap > remaining * 25;
  const maxConstructorPoints = Math.max(1, ...constructors.map((entry) => entry.points));

  return (
    <>
      <section className="hero">
        <HeroTrace />
        <div className="shell hero-grid">
          <div className="hero-main">
            <p className="hero-kicker mono">
              <span className="slash">///</span> The paddock desk · {season} season · round{" "}
              {overview.completedRounds} of {schedule.length}
            </p>
            <h1 className="sr-only">Brewing Paddock — F1, brewed strong</h1>
            <InstagramCoverflow
              posts={igPosts}
              handle={instagramHandle}
              url={instagramUrl}
              variant="hero"
            />
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/news">
                Read the wire
              </Link>
              <Link className="btn btn-ghost" href="/telemetry">
                Open telemetry
              </Link>
            </div>
          </div>

          <aside className="hero-side">
            {nextRace ? (
              <div className="race-card ticks">
                <div className="race-card-head">
                  <span className="mono kicker-red">Next on the grid</span>
                  <span className="mono race-round">R{String(nextRace.round).padStart(2, "0")}</span>
                </div>
                <h2 className="race-card-title">{nextRace.raceName.replace(" Grand Prix", "")}</h2>
                <p className="race-card-sub">
                  {nextRace.Circuit.Location.locality}, {nextRace.Circuit.Location.country}
                </p>
                <Countdown date={nextRace.date} />
                <div className="race-card-foot">
                  <span className="mono">{raceDay(nextRace.date)}</span>
                  <span className="mono">{daysUntil(nextRace.date)} days out</span>
                </div>
              </div>
            ) : (
              <div className="race-card ticks">
                <span className="mono kicker-red">Season complete</span>
                <h2 className="race-card-title">See you in March</h2>
                <p className="race-card-sub">The calendar is done. The archive is open.</p>
              </div>
            )}
          </aside>
        </div>

        <div className="shell">
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="mono hero-stat-label">Championship</span>
              <span className="hero-stat-value">
                {leader ? leader.driver.code : "—"}
                <em className="mono">{leader?.points ?? 0}</em>
              </span>
              <span className="hero-stat-note">
                {leader
                  ? `+${gap} on ${rival?.driver.familyName ?? "the field"}${clinched ? " · title settled" : ""}`
                  : "standings unavailable"}
              </span>
            </div>
            <div className="hero-stat">
              <span className="mono hero-stat-label">Last winner</span>
              <span className="hero-stat-value">
                {lastPodium[0]?.Driver.code ?? "—"}
                <em className="mono">P1</em>
              </span>
              <span className="hero-stat-note">
                {lastPodium[0]
                  ? `${lastPodium[0].Driver.familyName} for ${teamName(lastPodium[0].Constructor.constructorId)}`
                  : lastRace?.raceName ?? "no race data"}
              </span>
            </div>
            <div className="hero-stat">
              <span className="mono hero-stat-label">Rounds run</span>
              <span className="hero-stat-value">
                {overview.completedRounds}
                <em className="mono">/{schedule.length}</em>
              </span>
              <span className="hero-stat-note">{remaining} race{remaining === 1 ? "" : "s"} left this season</span>
            </div>
            <div className="hero-stat">
              <span className="mono hero-stat-label">Telemetry</span>
              <span className="hero-stat-value">
                3.7<em className="mono">Hz</em>
              </span>
              <span className="hero-stat-note">OpenF1 car data, fastest laps only</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="wire">
        <div className="shell">
          <SectionHead index="01" title="The wire" kicker="Aggregated headlines">
            <Link className="text-link mono" href="/news">
              All stories ↗
            </Link>
          </SectionHead>
          <NewsFeed />
        </div>
      </section>

      <section className="section" id="championship">
        <div className="shell">
          <SectionHead index="02" title="The championship" kicker={`Drivers · after round ${overview.completedRounds}`}>
            <div className="head-meta">
              <span className={`source-tag ${overview.source}`}>
                <span className="live-dot" aria-hidden="true" />
                {overview.source === "live" ? "Live feed" : "Cached snapshot"}
              </span>
              {lastRace ? (
                <Link className="text-link mono" href={`/race/${lastRace.round}`}>
                  Last race debrief ↗
                </Link>
              ) : null}
            </div>
          </SectionHead>

          {leader ? (
            <div className="champ-banner">
              <div className="champ-banner-main">
                <span className="champ-flag" style={{ background: teamColour(leader.constructor.constructorId) }} />
                <div>
                  <p className="mono kicker-red">Championship leader</p>
                  <h3 className="champ-name">
                    {leader.driver.givenName} {leader.driver.familyName}
                  </h3>
                </div>
              </div>
              <div className="champ-banner-stats">
                <div>
                  <span className="mono label">Points</span>
                  <strong className="mono">{leader.points}</strong>
                </div>
                <div>
                  <span className="mono label">Gap</span>
                  <strong className="mono">+{gap}</strong>
                </div>
                <div>
                  <span className="mono label">Wins</span>
                  <strong className="mono">{leader.wins}</strong>
                </div>
                <div>
                  <span className="mono label">Team</span>
                  <strong>{teamName(leader.constructor.constructorId)}</strong>
                </div>
              </div>
              <p className="champ-banner-note">
                {clinched
                  ? `With ${remaining} rounds left and ${remaining * 25} points on the table, the gap of ${gap} is already mathematically out of reach.`
                  : `${remaining * 25} points remain — the fight is live.`}
              </p>
            </div>
          ) : null}

          <div className="split">
            <div className="panel panel-table">
              <StandingsTable standings={standings} limit={12} />
            </div>
            <aside className="champ-aside">
              <div className="panel constructors">
                <div className="panel-head">
                  <h3>Constructors</h3>
                  <span className="mono">after R{overview.completedRounds}</span>
                </div>
                {constructors.slice(0, 8).map((entry) => (
                  <div className="constructor-row" key={entry.constructor.constructorId}>
                    <span className="mono pos">{entry.position}</span>
                    <span className="constructor-name">
                      {teamName(entry.constructor.constructorId, entry.constructor.name)}
                    </span>
                    <span className="constructor-bar">
                      <span
                        style={{
                          width: `${Math.max(3, (entry.points / maxConstructorPoints) * 100)}%`,
                          background: teamColour(entry.constructor.constructorId),
                        }}
                      />
                    </span>
                    <span className="mono pts">{entry.points}</span>
                  </div>
                ))}
              </div>

              {lastRace ? (
                <Link className="panel debrief-teaser" href={`/race/${lastRace.round}`}>
                  <span className="mono kicker-red">Auto debrief</span>
                  <h3>{lastRace.raceName.replace(" Grand Prix", "")} · the read</h3>
                  <p>
                    {lastPodium[0]
                      ? `${lastPodium[0].Driver.familyName} took it from P${lastPodium[0].grid}. The generated report covers the margin, the stops and the drives that mattered.`
                      : "The generated report covers the margin, the stops and the drives that mattered."}
                  </p>
                  <span className="mono text-link">Read the debrief ↗</span>
                </Link>
              ) : null}
            </aside>
          </div>
        </div>
      </section>

      <section className="section" id="tools">
        <div className="shell">
          <SectionHead index="03" title="The pit wall" kicker="Five tools, no paywall">
            <span className="mono section-note">Modelled on live season data</span>
          </SectionHead>
          <ModulesGrid latestRound={lastRace ? Number(lastRace.round) : undefined} />
        </div>
      </section>

      <section className="section section-tight" id="ask">
        <div className="shell cta-band">
          <div>
            <p className="mono kicker-red">Ask Paddock</p>
            <h2 className="cta-title">
              Who had the fastest sector 2 in Brazil? <em>Just ask.</em>
            </h2>
            <p className="cta-copy">
              A chatbot wired to the live championship, every 2026 classification, the telemetry
              archive and the rulebook digest. Every answer cites its source.
            </p>
          </div>
          <Link className="btn btn-primary" href="/ask">
            Open the chat
          </Link>
        </div>
      </section>
    </>
  );
}
