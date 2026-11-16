import { isFinisher, type PitStop, type QualifyingResult, type Race, type RaceResult } from "@/lib/f1";

export type DebriefStat = { label: string; value: string; note: string };

export type Debrief = {
  headline: string;
  deck: string;
  stats: DebriefStat[];
  paragraphs: string[];
  tags: string[];
  pipeline: string[];
};

function lastName(name: string): string {
  return name.split(" ").slice(-1)[0];
}

function lapSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildDebrief(args: {
  race: Race;
  results: RaceResult[];
  stops: PitStop[];
  quali: QualifyingResult[];
  season: number;
}): Debrief {
  const { race, results, stops, quali, season } = args;
  const circuit = race.Circuit.Location.locality;
  const winner = results[0];
  const second = results[1];
  const margin = second?.Time?.time?.startsWith("+") ? second.Time.time : null;
  const dnfs = results.filter((r) => !isFinisher(r.status));
  const finishers = results.filter((r) => isFinisher(r.status));

  const climber = [...results]
    .filter((r) => Number(r.grid) > 0)
    .sort((a, b) => Number(b.grid) - Number(b.position) - (Number(a.grid) - Number(a.position)))[0];
  const faller = [...results]
    .filter((r) => Number(r.grid) > 0)
    .sort((a, b) => Number(a.grid) - Number(a.position) - (Number(b.grid) - Number(b.position)))[0];

  const fastest = [...results]
    .filter((r) => r.FastestLap?.Time?.time)
    .sort((a, b) => (lapSeconds(a.FastestLap?.Time?.time) ?? 999) - (lapSeconds(b.FastestLap?.Time?.time) ?? 999))[0];

  const durations = stops
    .map((s) => Number(s.duration))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const bestStop = durations[0];
  const avgStop = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const bestStopRow = bestStop
    ? [...stops].sort((a, b) => Number(a.duration) - Number(b.duration))[0]
    : null;
  const bestStopDriver = bestStopRow
    ? results.find((row) => row.Driver.driverId === bestStopRow.driverId)?.Driver.familyName
    : undefined;

  const pole = quali[0];
  const winnerTeam = winner?.Constructor.name ?? "—";
  const teamFinishers = results.filter(
    (r) => r.Constructor.constructorId === winner?.Constructor.constructorId && Number(r.points) > 0,
  ).length;

  const winnerName = winner ? `${winner.Driver.givenName} ${winner.Driver.familyName}` : "The winner";
  const winnerSurname = winner ? lastName(winner.Driver.familyName) : "—";
  const marginValue = margin ? Number(margin.replace("+", "")) : null;
  const verb =
    marginValue !== null && marginValue > 12
      ? "DISMANTLES"
      : marginValue !== null && marginValue < 1.5
        ? "STEALS"
        : "OWNS";

  const headline = `${winnerSurname.toUpperCase()} ${verb} ${circuit.toUpperCase()}`;
  const deck = winner
    ? `${winnerName} wins the ${season} ${race.raceName} from P${winner.grid}${
        margin ? ` by ${margin.replace("+", "")}` : ""
      }, with ${fastest ? `${fastest.Driver.familyName} holding the fastest lap` : "no fastest-lap heroics"} and ${dnfs.length} retirement${dnfs.length === 1 ? "" : "s"} in the book.`
    : "The classification is not available yet.";

  const stats: DebriefStat[] = [
    {
      label: "Winning margin",
      value: margin ? margin.replace("+", "") : "—",
      note: margin ? `over ${second?.Driver.familyName}` : "classification pending",
    },
    {
      label: "Grid to flag",
      value: winner ? `P${winner.grid} → P1` : "—",
      note: winner && Number(winner.grid) > 1 ? `${Number(winner.grid) - 1} places gained` : "pole converted",
    },
    {
      label: "Fastest lap",
      value: fastest?.FastestLap?.Time?.time ?? "—",
      note: fastest ? `${fastest.Driver.familyName} · lap ${fastest.FastestLap?.lap}` : "no data",
    },
    {
      label: "Quickest pit lane",
      value: bestStop ? `${bestStop.toFixed(1)}s` : "—",
      note: bestStopDriver
        ? `${bestStopDriver}${avgStop ? ` · field average ${avgStop.toFixed(1)}s` : ""}`
        : "no stops logged",
    },
  ];

  const paragraphs: string[] = [];
  if (winner) {
    paragraphs.push(
      `The race turned on ${winner.Constructor.name}'s read of the first stint. ${winnerName} started P${winner.grid}, ${
        Number(winner.grid) === 1 ? "controlled the launch and never gave the lead away" : "worked through the order without ever looking rushed"
      }, and finished ${margin ? `${margin.replace("+", "")} clear of ${second?.Driver.familyName}` : "at the front"}. ${
        teamFinishers > 1 ? `Both cars scored for ${winnerTeam} — a proper pit-wall day.` : `The sister car could not back it up.`
      }`,
    );
  }
  paragraphs.push(
    `The stopwatch logged ${stops.length} pit stops for ${finishers.length} finishers${
      bestStop ? `, the slickest a ${bestStop.toFixed(1)}s pit lane${bestStopDriver ? ` for ${bestStopDriver}` : ""}` : ""
    }. ${
      avgStop
        ? `A field average of ${avgStop.toFixed(1)}s per pit lane is ${
            avgStop < 26 ? "quick, clean work from the crews" : "where a second of free track position went missing"
          }.`
        : ""
    }`,
  );
  if (climber && Number(climber.grid) - Number(climber.position) > 0) {
    paragraphs.push(
      `${climber.Driver.familyName} was the driver on the move: P${climber.grid} to P${climber.position}. ${
        faller && Number(faller.grid) < Number(faller.position)
          ? `Spare a thought for ${faller.Driver.familyName}, P${faller.grid} to P${faller.position}.`
          : "Nobody else found that kind of traction."
      }${
        dnfs.length > 0
          ? ` ${dnfs.length} car${dnfs.length === 1 ? "" : "s"} did not see the flag, which is where half the strategy calls were decided.`
          : " Every car saw the flag, so this one was won on pace, not attrition."
      }`,
    );
  }
  paragraphs.push(
    pole
      ? `${pole.Driver.familyName} took qualifying, but Saturday is not Sunday. ${winnerTeam}'s Sunday execution is the headline the pit wall will take to the next round.`
      : `${winnerTeam} leaves with the biggest data set of the weekend and the same question every rival is asking: how much of this was track-specific?`,
  );

  return {
    headline,
    deck,
    stats,
    paragraphs,
    tags: [race.raceName, `Round ${race.round}`, `${season} season`, winnerTeam],
    pipeline: [
      `Ingested ${results.length} classified rows from the ${race.raceName}.`,
      `Merged ${stops.length} pit stops and ${quali.length} qualifying entries.`,
      `Selected the angle: margin, grid delta, fastest lap, retirements.`,
      `Drafted ${paragraphs.length} paragraphs in the Paddock voice.`,
    ],
  };
}
