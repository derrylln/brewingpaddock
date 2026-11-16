import { getRaceResults, getSeasonOverview, getSeasonResults, type DriverStanding, type Race } from "@/lib/f1";
import { CACHED_TELEMETRY } from "@/lib/telemetry";
import { teamName } from "@/lib/teams";

export type AskTable = { columns: string[]; rows: Array<Array<string | number>> };

export type AskAnswer = {
  answer: string;
  bullets?: string[];
  table?: AskTable;
  citations: string[];
  suggestions: string[];
  /** "ai" when an LLM rephrased the grounded answer, "model" when it is the raw retrieval copy. */
  source?: "ai" | "model";
  model?: string | null;
};

type RuleDoc = { id: string; title: string; tags: string[]; text: string };

const RULES: RuleDoc[] = [
  {
    id: "points",
    title: "Championship points",
    tags: ["points", "score", "scoring", "championship", "fastest lap"],
    text: "A Grand Prix pays 25-18-15-12-10-8-6-4-2-1 to the top ten. There is no separate point for fastest lap. If a race is stopped early and cannot be resumed, half points are awarded provided enough of the scheduled distance has been completed.",
  },
  {
    id: "sprint",
    title: "Sprint format",
    tags: ["sprint", "shootout", "format", "saturday"],
    text: "A sprint weekend runs one practice session, sprint qualifying, the sprint itself (roughly 100km) and then main qualifying and the Grand Prix. The sprint pays 8-7-6-5-4-3-2-1 to the top eight, and the sprint result sets the grid for the Grand Prix.",
  },
  {
    id: "tyres",
    title: "Tyre rules",
    tags: ["tyre", "tire", "compound", "soft", "medium", "hard", "intermediate", "wet", "allocation"],
    text: "Pirelli brings six dry compounds across the season, C1 (hardest) to C6 (softest), and nominates three for each weekend. In a dry race every driver must use at least two different dry compounds, which is why one stop is effectively mandatory. Intermediates are for damp or lightly wet conditions; full wets are for standing water.",
  },
  {
    id: "qualifying",
    title: "Qualifying and parc fermé",
    tags: ["qualifying", "q1", "q2", "q3", "pole", "parc ferme", "grid"],
    text: "Qualifying is split into Q1 (18 minutes, slowest five eliminated), Q2 (15 minutes, slowest five eliminated) and Q3 (12 minutes, top ten shootout). Cars enter parc fermé after qualifying, so set-up changes before the race are heavily restricted.",
  },
  {
    id: "safetycar",
    title: "Safety car and red flags",
    tags: ["safety car", "sc", "vsc", "red flag", "restart", "neutralised"],
    text: "A safety car bunches the field and turns a pit stop into a bargain because the field is slow. The virtual safety car imposes a delta time instead. A red flag stops the session outright and allows tyre changes; the restart order is set by the classification at the time of the stoppage.",
  },
  {
    id: "aero",
    title: "Active aero and override",
    tags: ["drs", "aero", "active aero", "override", "overtaking", "straight"],
    text: "The 2026 cars use active aerodynamics rather than a DRS flap: low-drag mode on the straights, high-downforce mode in the corners. A chasing car within one second at the detection point can deploy manual override for extra electrical power on the following straight.",
  },
  {
    id: "powerunit",
    title: "2026 power units",
    tags: ["engine", "power unit", "pu", "hybrid", "fuel", "battery", "mguk"],
    text: "The 2026 power unit runs roughly a 50/50 split between the internal combustion engine and electrical power, drops the MGU-H, and runs on fully sustainable fuel. Component changes beyond the permitted allocation trigger grid penalties.",
  },
  {
    id: "flags",
    title: "Flags and penalties",
    tags: ["flag", "yellow", "blue", "black", "penalty", "grid penalty", "stewards"],
    text: "Yellow flags mean no overtaking and a readiness to stop; double yellow means be prepared to stop. Blue flags tell a lapped car to yield to a faster car. Stewards can issue time penalties, drive-throughs, stop-and-gos, or grid penalties that carry to the next event.",
  },
  {
    id: "tiebreak",
    title: "Countback",
    tags: ["tie", "countback", "equal", "tiebreak", "same points"],
    text: "If two drivers finish the season level on points, the title goes to the one with more wins, then more second places, then more third places, and so on down the classification.",
  },
];

function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(query: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`(^|[^a-z0-9])${esc(term.toLowerCase())}([^a-z0-9]|$)`).test(query);
}

function findDrivers(query: string, standings: DriverStanding[]): DriverStanding[] {
  const hits: DriverStanding[] = [];
  for (const entry of standings) {
    const keys = [
      entry.driver.code?.toLowerCase() ?? "",
      entry.driver.familyName.toLowerCase(),
      `${entry.driver.givenName} ${entry.driver.familyName}`.toLowerCase(),
      entry.driver.givenName.toLowerCase(),
    ];
    if (keys.some((key) => key.length > 2 && mentions(query, key))) hits.push(entry);
  }
  return hits.slice(0, 2);
}

function findRace(query: string, schedule: Race[]): Race | null {
  for (const race of schedule) {
    const short = race.raceName.toLowerCase().replace("grand prix", "").trim();
    const candidates = [
      short,
      race.Circuit.Location.locality.toLowerCase(),
      race.Circuit.Location.country.toLowerCase(),
      race.Circuit.circuitId.replace(/_/g, " ").toLowerCase(),
    ];
    if (candidates.some((term) => term.length > 3 && mentions(query, term))) return race;
    const words = race.Circuit.circuitName.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    if (words.some((word) => mentions(query, word))) return race;
  }
  return null;
}

function findRule(query: string): RuleDoc | null {
  let best: { doc: RuleDoc; score: number } | null = null;
  for (const doc of RULES) {
    let score = 0;
    for (const tag of doc.tags) if (mentions(query, tag)) score += 2;
    for (const word of doc.title.toLowerCase().split(/\s+/)) if (mentions(query, word)) score += 1;
    if (mentions(query, "rule") || mentions(query, "regulation")) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { doc, score };
  }
  return best?.doc ?? null;
}

function positionTable(standings: DriverStanding[], limit: number): AskTable {
  return {
    columns: ["Pos", "Driver", "Team", "Pts", "Wins"],
    rows: standings.slice(0, limit).map((entry) => [
      entry.position,
      `${entry.driver.code ?? entry.driver.familyName}`,
      teamName(entry.constructor.constructorId, entry.constructor.name),
      entry.points,
      entry.wins,
    ]),
  };
}

export async function answerQuestion(raw: string): Promise<AskAnswer> {
  const query = raw.toLowerCase().trim();
  const overview = await getSeasonOverview();
  const { standings, schedule, lastRace, nextRace, season } = overview;
  const leader = standings[0];
  const gapToSecond = leader && standings[1] ? leader.points - standings[1].points : 0;
  const defaultSuggestions = [
    "Who leads the championship?",
    "Who won the last race?",
    "When is the next race?",
    "What are the tyre rules?",
  ];

  if (!query) {
    return {
      answer: "Ask me about the championship, a race, a driver, tyre rules or the telemetry archive. I answer from the live season data this site already pulls.",
      citations: [`Jolpica · ${season} championship`],
      suggestions: defaultSuggestions,
    };
  }

  const drivers = findDrivers(query, standings);
  const race = findRace(query, schedule);

  // Sector or fastest-lap telemetry questions
  if (mentions(query, "sector") || (mentions(query, "fastest") && mentions(query, "lap"))) {
    const sectorMatch = query.match(/sector\s*([123])/);
    const session = CACHED_TELEMETRY.session;
    if (race && !mentions(query, session.circuit.toLowerCase()) && sectorMatch) {
      return {
        answer: `The telemetry archive currently holds the latest session — ${session.year} ${session.name} at ${session.circuit}, not ${race.raceName}. I can give you the classification for that race instead.`,
        table: await raceTable(race, season),
        citations: [`OpenF1 · ${session.year} ${session.circuit} ${session.name}`, `Jolpica · ${season} ${race.raceName}`],
        suggestions: [`Fastest sector 2 in the last race?`, `Who won the ${race.raceName}?`],
      };
    }
    if (sectorMatch) {
      const index = Number(sectorMatch[1]) - 1;
      const [a, b] = CACHED_TELEMETRY.drivers;
      const winner = a.sectors[index] <= b.sectors[index] ? a : b;
      const other = winner === a ? b : a;
      return {
        answer: `${winner.code} holds the fastest sector ${index + 1} in the archive: ${winner.sectors[index].toFixed(3)}s in the ${session.year} ${session.name} at ${session.circuit}, ${Math.abs(winner.sectors[index] - other.sectors[index]).toFixed(3)}s up on ${other.code}.`,
        bullets: [
          `${a.code} · S1 ${a.sectors[0].toFixed(3)} · S2 ${a.sectors[1].toFixed(3)} · S3 ${a.sectors[2].toFixed(3)}`,
          `${b.code} · S1 ${b.sectors[0].toFixed(3)} · S2 ${b.sectors[1].toFixed(3)} · S3 ${b.sectors[2].toFixed(3)}`,
          "Sector times come from the two fastest race laps of that session.",
        ],
        citations: [`OpenF1 · ${session.year} ${session.circuit} ${session.name} telemetry`],
        suggestions: ["Compare their speed traces", "Who had the fastest lap?", "Who leads the championship?"],
      };
    }
    if (lastRace) {
      const results = await getRaceResults(season, lastRace.round);
      const fastest = results.find((r) => r.FastestLap?.rank === "1");
      if (fastest) {
        return {
          answer: `${fastest.Driver.familyName} set the fastest lap of the ${lastRace.raceName}: ${fastest.FastestLap?.Time?.time} on lap ${fastest.FastestLap?.lap}.`,
          citations: [`Jolpica · ${season} ${lastRace.raceName} results`],
          suggestions: ["Who won the last race?", "Fastest sector 2 in the last race?", "What are the tyre rules?"],
        };
      }
    }
  }

  // Specific race result
  if (race) {
    const results = await getRaceResults(season, race.round);
    if (results.length > 0) {
      const podium = results.slice(0, 3);
      return {
        answer: `${podium[0].Driver.givenName} ${podium[0].Driver.familyName} won the ${season} ${race.raceName} at ${race.Circuit.Location.locality} for ${teamName(podium[0].Constructor.constructorId, podium[0].Constructor.name)}${
          podium[1]?.Time?.time?.startsWith("+") ? ` by ${podium[1].Time.time.replace("+", "")}` : ""
        }. ${podium[1] ? `${podium[1].Driver.familyName} was second` : ""}${podium[2] ? `, ${podium[2].Driver.familyName} third` : ""}.`,
        table: {
          columns: ["Pos", "Driver", "Team", "Grid", "Pts"],
          rows: podium.map((row) => [
            row.position,
            row.Driver.familyName,
            teamName(row.Constructor.constructorId, row.Constructor.name),
            row.grid,
            row.points,
          ]),
        },
        citations: [`Jolpica · ${season} ${race.raceName} classification`],
        suggestions: ["Who leads the championship?", "When is the next race?", "What are the tyre rules?"],
      };
    }
  }

  // Wins / podiums for a driver
  if (drivers.length > 0 && (mentions(query, "win") || mentions(query, "victories") || mentions(query, "podium") || mentions(query, "how many"))) {
    const driver = drivers[0];
    const archive = await getSeasonResults(season);
    const wins: string[] = [];
    let podiums = 0;
    for (const round of archive) {
      const row = round.results.find((r) => r.Driver.driverId === driver.driver.driverId);
      if (!row) continue;
      const pos = Number(row.position);
      if (pos === 1) wins.push(round.raceName.replace(" Grand Prix", ""));
      if (pos <= 3) podiums += 1;
    }
    return {
      answer: `${driver.driver.givenName} ${driver.driver.familyName} has ${wins.length} win${wins.length === 1 ? "" : "s"} and ${podiums} podium${podiums === 1 ? "" : "s"} from ${archive.length} rounds of ${season}, with ${driver.points} points and championship position P${driver.position}.`,
      bullets: wins.length > 0 ? wins.map((name) => `Won the ${name} Grand Prix`) : ["No wins this season yet."],
      citations: [`Jolpica · ${season} season results`, `Jolpica · ${season} drivers' championship`],
      suggestions: [`Who leads the championship?`, `What are the tyre rules?`, `When is the next race?`],
    };
  }

  // Gap between two drivers
  if (drivers.length === 2) {
    const [a, b] = drivers;
    return {
      answer: `${a.driver.familyName} leads ${b.driver.familyName} by ${Math.abs(a.points - b.points)} points (${a.points} to ${b.points}) after round ${overview.completedRounds} of ${season}.`,
      table: positionTable([a, b], 2),
      citations: [`Jolpica · ${season} drivers' championship`],
      suggestions: ["Who leads the championship?", "When is the next race?"],
    };
  }

  // Championship leader
  if (mentions(query, "championship") || mentions(query, "leader") || mentions(query, "leading") || mentions(query, "standings") || mentions(query, "who's winning")) {
    const remaining = schedule.length - overview.completedRounds;
    const clinched = gapToSecond > remaining * 25;
    return {
      answer: `${leader.driver.givenName} ${leader.driver.familyName} leads the ${season} championship on ${leader.points} points, ${gapToSecond} ahead of ${standings[1]?.driver.familyName ?? "the field"}, with ${remaining} round${remaining === 1 ? "" : "s"} left.${clinched ? ` At ${remaining * 25} points still available, the gap is already mathematically decisive.` : ""}`,
      table: positionTable(standings, 5),
      citations: [`Jolpica · ${season} drivers' championship`],
      suggestions: ["Who won the last race?", "When is the next race?", "What are the tyre rules?"],
    };
  }

  // Next race
  if (mentions(query, "next") || mentions(query, "when") || mentions(query, "calendar") || mentions(query, "schedule")) {
    if (nextRace) {
      const days = Math.max(0, Math.ceil((Date.parse(`${nextRace.date}T12:00:00Z`) - Date.now()) / 86400000));
      return {
        answer: `The next round is the ${season} ${nextRace.raceName} at ${nextRace.Circuit.circuitName}, ${nextRace.Circuit.Location.locality}, on ${nextRace.date} — ${days} day${days === 1 ? "" : "s"} away.`,
        bullets: [
          `Round ${nextRace.round} of ${schedule.length}`,
          nextRace.Qualifying ? `Qualifying ${nextRace.Qualifying.date}` : "Qualifying schedule to be confirmed",
          nextRace.Sprint ? "Sprint weekend" : "Standard weekend format",
        ],
        citations: [`Jolpica · ${season} calendar`],
        suggestions: ["Who leads the championship?", "Who won the last race?", "How many races are left?"],
      };
    }
    return {
      answer: `The ${season} calendar is complete. The next full season is already in the data pipeline.`,
      citations: [`Jolpica · ${season} calendar`],
      suggestions: ["Who leads the championship?", "Who won the last race?"],
    };
  }

  // Rulebook
  const rule = findRule(query);
  if (rule) {
    return {
      answer: rule.text,
      citations: [`FIA sporting regulations · ${rule.title} digest`],
      suggestions: ["Who leads the championship?", "Who won the last race?", "When is the next race?"],
    };
  }

  // Last race fallback
  if (lastRace) {
    const results = await getRaceResults(season, lastRace.round);
    if (results[0]) {
      return {
        answer: `The most recent round was the ${lastRace.raceName}, won by ${results[0].Driver.givenName} ${results[0].Driver.familyName} for ${teamName(results[0].Constructor.constructorId, results[0].Constructor.name)}. Ask me about a driver's wins, the points gap, a specific race, sector times or the rulebook.`,
        table: positionTable(standings, 5),
        citations: [`Jolpica · ${season} ${lastRace.raceName}`, `Jolpica · ${season} championship`],
        suggestions: defaultSuggestions,
      };
    }
  }

  return {
    answer: "I could not ground that one in the data this site holds. I cover the current championship, every 2026 race result, sector times from the latest telemetry session and the rulebook digest.",
    citations: [`Jolpica · ${season} championship`, "OpenF1 · latest session"],
    suggestions: defaultSuggestions,
  };
}

async function raceTable(race: Race, season: number): Promise<AskTable> {
  const results = await getRaceResults(season, race.round);
  return {
    columns: ["Pos", "Driver", "Team", "Pts"],
    rows: results.slice(0, 3).map((row) => [
      row.position,
      row.Driver.familyName,
      teamName(row.Constructor.constructorId, row.Constructor.name),
      row.points,
    ]),
  };
}
