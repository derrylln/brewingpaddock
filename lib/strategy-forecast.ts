import {
  CIRCUITS,
  pricePlanOn,
  type CircuitKey,
  type CircuitProfile,
  type Compound,
  type StrategyOption,
} from "@/lib/strategy";

/**
 * Race-plan forecast.
 *
 * The stint model prices one scenario at a time. A race weekend is not one
 * scenario, so this enumerates every sensible plan across the whole race and
 * prices each one under a small weighted set of conditions (track temperature
 * and safety-car likelihood). Plans are grouped by shape — "one stop, medium to
 * hard" — and the weights become the probability we show. The numbers stay the
 * model's; the grouping is the only thing added here.
 */

export type ForecastRace = {
  name: string;
  round: number;
  circuit: CircuitKey | null;
  circuitName: string;
  laps: number;
  date: string;
  /** Scheduled start, where the calendar has one; the cutoff for a pre-race save. */
  time?: string;
  country: string;
};

export type ForecastPlan = {
  id: string;
  label: string;
  stops: number;
  compounds: Compound[];
  pitLaps: number[];
  probability: number;
  expectedTime: number;
  delta: number;
  risk: StrategyOption["risk"];
  notes: string[];
};

export type StrategyForecast = {
  race: ForecastRace;
  plans: ForecastPlan[];
  scenarios: number;
  assumptions: string[];
  call: string;
};

const ALIASES: Record<string, CircuitKey> = {
  lasvegas: "las_vegas",
  interlagos: "interlagos",
  saopaulo: "interlagos",
  monza: "monza",
  italy: "monza",
  vegas: "las_vegas",
  singapore: "marina_bay",
  marinabay: "marina_bay",
  silverstone: "silverstone",
  britain: "silverstone",
  spa: "spa",
  belgium: "spa",
  yasmarina: "yas_marina",
  abudhabi: "yas_marina",
  zandvoort: "zandvoort",
  netherlands: "zandvoort",
};

const LAPS_BY_CIRCUIT: Record<string, number> = {
  bahrain: 57,
  jeddah: 50,
  melbourne: 58,
  suzuka: 53,
  shanghai: 56,
  miami: 57,
  imola: 63,
  monaco: 78,
  catalunya: 66,
  barcelona: 66,
  villeneuve: 70,
  montreal: 70,
  redbullring: 71,
  spielberg: 71,
  hungaroring: 70,
  spa: 44,
  zandvoort: 72,
  monza: 53,
  baku: 51,
  marina: 62,
  singapore: 62,
  austin: 56,
  mexicocity: 71,
  interlagos: 71,
  saopaulo: 71,
  lasvegas: 50,
  lusail: 57,
  qatar: 57,
  yasmarina: 58,
  abudhabi: 58,
  silverstone: 52,
  vegas: 50,
  americas: 56,
  rodriguez: 71,
  losail: 57,
  sepang: 56,
  madring: 57,
};

function profileFor(key: CircuitKey | null, laps: number, name: string): CircuitProfile {
  if (key) return CIRCUITS[key];
  return {
    name,
    laps,
    baseLap: 90,
    pitLoss: 22,
    abrasion: 1,
    overtaking: "medium",
    note: "No bespoke model for this circuit yet, so default abrasion and pit loss apply.",
  };
}

export function circuitForRace(race: {
  raceName: string;
  circuitId: string;
  round: number;
  date: string;
  country: string;
  time?: string;
  laps?: number;
}): ForecastRace {
  const id = race.circuitId.toLowerCase().replace(/[^a-z]/g, "");
  const key = ALIASES[id] ?? null;
  const laps = race.laps ?? LAPS_BY_CIRCUIT[id] ?? 57;
  const profile = profileFor(key, laps, race.raceName.replace(" Grand Prix", ""));

  return {
    name: race.raceName,
    round: race.round,
    circuit: key,
    circuitName: profile.name,
    laps: profile.laps,
    date: race.date,
    time: race.time,
    country: race.country,
  };
}

type Scenario = {
  safetyCar: boolean;
  window?: { from: number; to: number };
  trackTemp: number;
  weight: number;
  note: string;
};

/**
 * Safety-car exposure per circuit: the chance of at least one deployment.
 * Street tracks and low-grip layouts where passing is hard sit high; the
 * permanent, low-degradation circuits sit low. This replaces the flat 28% the
 * forecast used to apply to every race.
 */
const SC_PROBABILITY: Partial<Record<CircuitKey, number>> = {
  marina_bay: 0.6,
  zandvoort: 0.46,
  interlagos: 0.4,
  spa: 0.36,
  silverstone: 0.32,
  las_vegas: 0.26,
  monza: 0.22,
  yas_marina: 0.2,
};

function safetyCarProbability(key: CircuitKey | null, profile: CircuitProfile): number {
  const explicit = key ? SC_PROBABILITY[key] : undefined;
  if (explicit !== undefined) return explicit;
  const overtaking =
    profile.overtaking === "hard" ? 0.16 : profile.overtaking === "medium" ? 0.06 : 0.02;
  return Math.min(0.6, 0.16 + overtaking + Math.max(0, profile.abrasion - 1) * 0.16);
}

/**
 * The scenario set, weighted by late-race conditions rather than a flat average.
 *
 * Two things move the weights:
 *
 * - Degradation pressure. On a high-abrasion circuit the hot-track outcomes are
 *   likelier and the cool ones less so, because the race is decided by who
 *   manages the tyre at the end.
 * - Safety cars, timed where they happen. Most deployments fall in the second
 *   half, and a cheap stop only exists if the stop falls inside the window, so
 *   the window is passed to the model instead of a lap-1 flag.
 */
function scenariosFor(profile: CircuitProfile, key: CircuitKey | null): Scenario[] {
  const laps = profile.laps;
  const scProb = safetyCarProbability(key, profile);
  const deg = profile.abrasion;

  // Hotter races push weight towards fresh rubber late; cool ones towards track position.
  const cool = Math.max(0.08, 0.34 - (deg - 0.9) * 0.22);
  const typical = 0.46;
  const hot = Math.max(0.08, 0.2 + (deg - 0.9) * 0.24);
  const cleanBudget = 1 - scProb;
  const tempTotal = cool + typical + hot;

  const thirdQuarter = { from: Math.round(laps * 0.5), to: Math.round(laps * 0.72) };
  const finalQuarter = { from: Math.round(laps * 0.72), to: laps };
  const lateShare = 0.72;

  return [
    {
      safetyCar: false,
      trackTemp: 22,
      weight: (cleanBudget * cool) / tempTotal,
      note: "cool track, clean race",
    },
    {
      safetyCar: false,
      trackTemp: 30,
      weight: (cleanBudget * typical) / tempTotal,
      note: "typical track temperature",
    },
    {
      safetyCar: false,
      trackTemp: 40,
      weight: (cleanBudget * hot) / tempTotal,
      note: "hot track, faster degradation",
    },
    {
      safetyCar: true,
      window: thirdQuarter,
      trackTemp: 30,
      weight: scProb * (1 - lateShare),
      note: "safety car in the third quarter",
    },
    {
      safetyCar: true,
      window: finalQuarter,
      trackTemp: 34,
      weight: scProb * lateShare,
      note: "safety car in the final quarter",
    },
  ];
}

const STARTS: Array<{ compound: Compound; weight: number }> = [
  { compound: "medium", weight: 0.5 },
  { compound: "soft", weight: 0.3 },
  { compound: "hard", weight: 0.2 },
];

type Sample = { option: StrategyOption; scenario: Scenario; start: Compound };

function planShapes(totalLaps: number): Array<Array<{ lap: number; compound: Compound }>> {
  const plans: Array<Array<{ lap: number; compound: Compound }>> = [[]];
  const dry: Compound[] = ["soft", "medium", "hard"];
  const firstWindow = { from: Math.round(totalLaps * 0.18), to: Math.round(totalLaps * 0.72) };
  const secondWindow = { from: Math.round(totalLaps * 0.42), to: Math.round(totalLaps * 0.85) };

  for (const compound of dry) {
    for (let lap = firstWindow.from; lap <= firstWindow.to; lap += 2) {
      plans.push([{ lap, compound }]);
    }
  }
  for (const first of dry) {
    for (const second of dry) {
      if (first === second) continue;
      for (let a = secondWindow.from; a <= secondWindow.to - 10; a += 4) {
        for (let b = a + 10; b <= secondWindow.to; b += 6) {
          plans.push([
            { lap: a, compound: first },
            { lap: b, compound: second },
          ]);
        }
      }
    }
  }
  return plans;
}

function labelFor(option: StrategyOption): string {
  if (option.stops === 0) return "No stop";
  return `${option.stops === 1 ? "One stop" : "Two stops"} · ${option.stints
    .map((stint) => stint.compound[0].toUpperCase())
    .join("→")}`;
}

function meanLap(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function forecastRace(race: ForecastRace): StrategyForecast {
  const profile = profileFor(race.circuit, race.laps || 57, race.circuitName);
  const totalLaps = profile.laps;
  const plans = planShapes(totalLaps);
  const scenarios = scenariosFor(profile, race.circuit);

  const groups = new Map<
    string,
    { weight: number; best: Sample; laps: number[][]; notes: Set<string> }
  >();
  let weightTotal = 0;

  for (const scenario of scenarios) {
    for (const start of STARTS) {
      const weight = scenario.weight * start.weight;
      weightTotal += weight;

      let best: Sample | null = null;
      for (const stops of plans) {
        const option = pricePlanOn(
          profile,
          {
            circuit: race.circuit ?? "interlagos",
            lap: 1,
            totalLaps,
            compound: start.compound,
            tyreAge: 0,
            gapAhead: 1.5,
            gapBehind: 1.5,
            safetyCar: scenario.safetyCar,
            safetyCarWindow: scenario.window,
            trackTemp: scenario.trackTemp,
            rain: "dry",
          },
          stops,
        );
        if (!best || option.totalTime < best.option.totalTime) {
          best = { option, scenario, start: start.compound };
        }
      }
      if (!best) continue;

      const label = labelFor(best.option);
      const group = groups.get(label) ?? {
        weight: 0,
        best,
        laps: [],
        notes: new Set<string>(),
      };
      group.weight += weight;
      if (best.option.totalTime < group.best.option.totalTime) group.best = best;
      group.laps.push(
        best.option.stints.slice(0, -1).map((stint) => stint.toLap + 1),
      );
      for (const note of best.option.notes) group.notes.add(note);
      groups.set(label, group);
    }
  }

  const ranked = [...groups.entries()]
    .map<ForecastPlan>(([label, group]) => {
      const pitLaps = Array.from({ length: group.best.option.stops }, (_, index) =>
        meanLap(group.laps.map((laps) => laps[index] ?? 0).filter((lap) => lap > 0)),
      );
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        label,
        stops: group.best.option.stops,
        compounds: group.best.option.stints.map((stint) => stint.compound),
        pitLaps,
        probability: group.weight / Math.max(weightTotal, 0.0001),
        expectedTime: group.best.option.totalTime,
        delta: 0,
        risk: group.best.option.risk,
        notes: [...group.notes].slice(0, 3),
      };
    })
    .sort((a, b) => b.probability - a.probability || a.expectedTime - b.expectedTime)
    .slice(0, 5);

  const bestTime = Math.min(...ranked.map((plan) => plan.expectedTime));
  ranked.forEach((plan) => {
    plan.delta = plan.expectedTime - bestTime;
  });

  const favourite = ranked[0];
  const alternative = ranked[1];
  const scProb = scenarios
    .filter((scenario) => scenario.safetyCar)
    .reduce((sum, scenario) => sum + scenario.weight, 0);
  const lateShare = 0.72;
  const call = favourite
    ? `${favourite.label} leads the forecast at ${Math.round(favourite.probability * 100)}% across ${
        scenarios.length
      } weather and safety-car scenarios${
        favourite.stops > 0
          ? `, with the stop around lap ${favourite.pitLaps[0]}`
          : ", with no stop priced"
      }. ${alternative ? `${alternative.label} is the live alternative at ${Math.round(
          alternative.probability * 100,
        )}%.` : "No credible alternative emerged."}`
    : "The model found no plan for this race.";

  return {
    race,
    plans: ranked,
    scenarios: scenarios.length * STARTS.length,
    assumptions: [
      `Track temperature modelled at ${scenarios
        .filter((scenario) => !scenario.safetyCar)
        .map((scenario) => `${scenario.trackTemp}°C`)
        .join(", ")}, weighted by the circuit's degradation pressure (abrasion ${profile.abrasion.toFixed(
        2,
      )}).`,
      `Safety car priced at ${Math.round(scProb * 100)}% for ${profile.name}: ${Math.round(
        scProb * (1 - lateShare) * 100,
      )}% in the third quarter and ${Math.round(
        scProb * lateShare * 100,
      )}% in the final quarter, not on lap one.`,
      "Dry running only: this is the baseline plan, not a wet-race call.",
      "A stop inside a safety-car window is priced at roughly 40% of a green-flag pit loss.",
      "Percentages are weighted scenario wins, so the plan with the fastest single projection is not always the favourite.",
    ],
    call,
  };
}
