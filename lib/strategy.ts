export type Compound = "soft" | "medium" | "hard" | "inter" | "wet";
export type CircuitKey =
  | "interlagos"
  | "las_vegas"
  | "monza"
  | "marina_bay"
  | "silverstone"
  | "spa"
  | "yas_marina"
  | "zandvoort";

export type CircuitProfile = {
  name: string;
  laps: number;
  baseLap: number;
  pitLoss: number;
  abrasion: number;
  overtaking: "easy" | "medium" | "hard";
  note: string;
};

export const CIRCUITS: Record<CircuitKey, CircuitProfile> = {
  interlagos: {
    name: "Interlagos",
    laps: 71,
    baseLap: 72.6,
    pitLoss: 21.0,
    abrasion: 0.95,
    overtaking: "easy",
    note: "Short lap, long pit lane, but the drag up to Turn 1 makes the undercut live.",
  },
  las_vegas: {
    name: "Las Vegas",
    laps: 50,
    baseLap: 96.4,
    pitLoss: 22.5,
    abrasion: 0.75,
    overtaking: "easy",
    note: "Cold asphalt and a huge straight: tyres take forever to switch on.",
  },
  monza: {
    name: "Monza",
    laps: 53,
    baseLap: 83.2,
    pitLoss: 23.0,
    abrasion: 0.7,
    overtaking: "medium",
    note: "Low degradation, enormous pit loss — track position is king.",
  },
  marina_bay: {
    name: "Marina Bay",
    laps: 62,
    baseLap: 96.2,
    pitLoss: 25.5,
    abrasion: 1.25,
    overtaking: "hard",
    note: "Street circuit, safety cars are a strategy variable, not an accident.",
  },
  silverstone: {
    name: "Silverstone",
    laps: 52,
    baseLap: 89.4,
    pitLoss: 22.0,
    abrasion: 1.15,
    overtaking: "medium",
    note: "High energy corners punish a hot rear tyre very quickly.",
  },
  spa: {
    name: "Spa",
    laps: 44,
    baseLap: 107.2,
    pitLoss: 21.0,
    abrasion: 1.0,
    overtaking: "medium",
    note: "Long lap, weather on two sides of the track, huge stint spread.",
  },
  yas_marina: {
    name: "Yas Marina",
    laps: 58,
    baseLap: 86.4,
    pitLoss: 22.0,
    abrasion: 0.85,
    overtaking: "medium",
    note: "Smooth surface, easy on rubber, hard to follow through the final sector.",
  },
  zandvoort: {
    name: "Zandvoort",
    laps: 72,
    baseLap: 73.4,
    pitLoss: 20.5,
    abrasion: 1.05,
    overtaking: "hard",
    note: "Banked corners and one real passing spot: track position is currency.",
  },
};

type CompoundMeta = { label: string; offset: number; deg: number; life: number; code: string };

const DRY: Record<"soft" | "medium" | "hard", CompoundMeta> = {
  soft: { label: "Soft", offset: -0.55, deg: 0.075, life: 19, code: "S" },
  medium: { label: "Medium", offset: 0, deg: 0.048, life: 27, code: "M" },
  hard: { label: "Hard", offset: 0.35, deg: 0.031, life: 36, code: "H" },
};

const WET_META: CompoundMeta = { label: "Inter", offset: 0, deg: 0.09, life: 24, code: "I" };
const FULL_WET: CompoundMeta = { label: "Wet", offset: 0, deg: 0.1, life: 26, code: "W" };

export type Rain = "dry" | "drying" | "light" | "heavy";

function meta(compound: Compound): CompoundMeta {
  if (compound === "inter") return WET_META;
  if (compound === "wet") return FULL_WET;
  return DRY[compound];
}

function compoundOffset(compound: Compound, rain: Rain): number {
  const wet = compound === "inter" || compound === "wet";
  if (rain === "dry") {
    if (wet) return 12;
    return DRY[compound as "soft" | "medium" | "hard"].offset;
  }
  if (rain === "drying") {
    if (compound === "inter") return -3.2;
    if (compound === "wet") return 1.5;
    return 4.5;
  }
  if (rain === "light") {
    if (compound === "inter") return -1.4;
    if (compound === "wet") return 0.6;
    return 9;
  }
  if (compound === "wet") return -7.5;
  if (compound === "inter") return -3.5;
  return 18;
}

function lapTime(
  circuit: CircuitProfile,
  compound: Compound,
  tyreAge: number,
  trackTemp: number,
  rain: Rain,
): number {
  const info = meta(compound);
  const wet = compound === "inter" || compound === "wet";
  const tempFactor = 1 + Math.max(-0.25, (trackTemp - 30) * (wet ? 0.004 : 0.013));
  const slope = info.deg * circuit.abrasion * tempFactor;
  const cliff = info.life * (wet ? 0.85 : 1);
  const age = Math.max(0, tyreAge);
  const withinLife = Math.min(age, cliff);
  const beyond = Math.max(0, age - cliff);
  // Past the cliff the tyre keeps falling away, but the loss flattens: no tyre loses
  // a second a lap forever. Cap the steep phase so long stints stay believable.
  const cliffLoss = slope * 1.4 * Math.min(beyond, 10) + slope * 0.35 * Math.max(0, beyond - 10);
  return circuit.baseLap + compoundOffset(compound, rain) + slope * withinLife + cliffLoss;
}

export type StrategyInput = {
  circuit: CircuitKey;
  lap: number;
  totalLaps: number;
  compound: Compound;
  tyreAge: number;
  gapAhead: number;
  gapBehind: number;
  safetyCar: boolean;
  trackTemp: number;
  rain: Rain;
};

export type Stint = { compound: Compound; fromLap: number; toLap: number };

export type StrategyOption = {
  id: string;
  label: string;
  stops: number;
  stints: Stint[];
  totalTime: number;
  delta: number;
  risk: "low" | "medium" | "high";
  notes: string[];
};

export type StrategyResult = {
  options: StrategyOption[];
  baseline: number;
  call: string;
  transcript: Array<{ role: "engineer" | "driver"; text: string }>;
  undercut: string;
};

type Plan = { stops: Array<{ lap: number; compound: Compound }> };

function simulate(input: StrategyInput, circuit: CircuitProfile, plan: Plan): StrategyOption {
  const stints: Stint[] = [];
  const notes: string[] = [];
  let total = 0;
  let compound = input.compound;
  let age = input.tyreAge;
  let stintStart = Math.max(1, input.lap - input.tyreAge);
  let stopsDone = 0;
  const pitLaps = new Map(plan.stops.map((stop) => [stop.lap, stop.compound]));

  for (let lap = input.lap; lap <= input.totalLaps; lap += 1) {
    if (pitLaps.has(lap) && lap > 1) {
      stints.push({ compound, fromLap: stintStart, toLap: lap - 1 });
      const loss = input.safetyCar && lap <= input.lap + 3 ? circuit.pitLoss * 0.42 : circuit.pitLoss;
      total += loss;
      stopsDone += 1;
      compound = pitLaps.get(lap) as Compound;
      age = 0;
      stintStart = lap;
      if (input.safetyCar && lap <= input.lap + 3) {
        notes.push("Safety car on track: pit loss drops to roughly 40% of a green-flag stop.");
      }
      if (input.gapBehind < 2.2 && lap === input.lap) {
        notes.push("Rejoining in traffic — you will lose around 1.2s behind the car you just covered.");
        total += 1.2;
      }
    }
    total += lapTime(circuit, compound, age, input.trackTemp, input.rain);
    age += 1;
  }
  stints.push({ compound, fromLap: stintStart, toLap: input.totalLaps });

  const finalAge = stints[stints.length - 1].toLap - stints[stints.length - 1].fromLap + 1;
  const finalCompound = stints[stints.length - 1].compound;
  const overLife = Math.max(0, finalAge - meta(finalCompound).life);

  if (overLife > 0) {
    notes.push(`Runs ${overLife} laps past the ${meta(finalCompound).label.toLowerCase()} cliff — expect a late drop-off.`);
  }
  if (input.rain === "drying" && finalCompound !== "inter") {
    notes.push("Track is drying: staying on a dry tyre is quick now, but a late shower flips this call.");
  }
  if (input.rain === "light" && finalCompound !== "inter") {
    notes.push("Standing water on a dry tyre — this only works if the rain stops.");
  }

  const risk: StrategyOption["risk"] =
    overLife > 4 || (input.rain === "heavy" && finalCompound !== "wet") || (input.rain === "dry" && (finalCompound === "inter" || finalCompound === "wet"))
      ? "high"
      : overLife > 0 || input.rain !== "dry" || stopsDone > 1
        ? "medium"
        : "low";

  // A plan that runs a tyre into the cliff is not really "faster" if it falls off a cliff in
  // the last ten laps. Price the risk into the projected race time instead of hiding it.
  const riskPenalty = risk === "high" ? 8 : risk === "medium" ? 2 : 0;
  total += riskPenalty;
  if (riskPenalty > 0) {
    notes.push(`Risk allowance: ${riskPenalty.toFixed(1)}s added for a ${risk}-risk stint profile.`);
  }

  const label =
    plan.stops.length === 0
      ? `Stay out on ${meta(input.compound).label.toLowerCase()}`
      : `Pit L${plan.stops[0].lap} → ${meta(plan.stops[0].compound).label}` +
        (plan.stops[1] ? `, L${plan.stops[1].lap} → ${meta(plan.stops[1].compound).label}` : "");

  return {
    id: `${plan.stops.map((s) => `${s.lap}${s.compound[0]}`).join("-") || "stay"}`,
    label,
    stops: plan.stops.length,
    stints,
    totalTime: total,
    delta: 0,
    risk,
    notes,
  };
}

export function buildStrategies(input: StrategyInput): StrategyResult {
  const circuit = CIRCUITS[input.circuit];
  const totalLaps = Math.max(input.lap + 1, Math.min(input.totalLaps, circuit.laps));
  const merged: StrategyInput = { ...input, totalLaps };

  const plans: Plan[] = [{ stops: [] }];
  const compounds: Compound[] =
    input.rain === "heavy" ? ["wet", "inter"] : input.rain === "light" ? ["inter", "wet", "medium"] : input.rain === "drying" ? ["medium", "inter", "soft"] : ["medium", "hard", "soft"];
  const horizon = Math.min(totalLaps - 2, input.lap + 30);

  for (const compound of compounds) {
    for (let lap = input.lap + 1; lap <= horizon; lap += 2) {
      plans.push({ stops: [{ lap, compound }] });
    }
  }
  if (input.rain !== "heavy") {
    for (let first = input.lap + 2; first <= horizon; first += 4) {
      for (let second = first + 8; second <= totalLaps - 2; second += 6) {
        plans.push({
          stops: [
            { lap: first, compound: input.rain === "dry" ? "medium" : "inter" },
            { lap: second, compound: input.rain === "dry" ? "soft" : "wet" },
          ],
        });
      }
    }
  }

  const options = plans
    .map((plan) => simulate(merged, circuit, plan))
    .sort((a, b) => a.totalTime - b.totalTime)
    .slice(0, 12);

  const best = options[0];
  options.forEach((option) => {
    option.delta = option.totalTime - best.totalTime;
  });
  const baseline = simulate(merged, circuit, { stops: [] });
  const improvement = baseline.totalTime - best.totalTime;

  const undercut =
    input.gapAhead < 1.5 && !input.safetyCar
      ? `You are ${input.gapAhead.toFixed(1)}s behind the car ahead — inside undercut range.`
      : input.gapAhead < 3
        ? "The car ahead is close enough to cover a reactive stop."
        : "The car ahead is out of range; this is a free-strategy call.";

  const call =
    best.stops === 0
      ? `No stop needed. Extend the ${meta(input.compound).label.toLowerCase()} to the flag and manage the rear.`
      : `${best.label}. ${improvement >= 0 ? `Projects ${improvement.toFixed(1)}s ahead of not stopping again, risk included` : `Only ${Math.abs(improvement).toFixed(1)}s worse than not stopping, so it is a defensive move`} with a ${best.risk} risk profile.`;

  const transcript: Array<{ role: "engineer" | "driver"; text: string }> = [
    {
      role: "engineer",
      text: `Lap ${input.lap} of ${totalLaps}, ${meta(input.compound).label.toLowerCase()} on lap ${input.tyreAge}. ${input.safetyCar ? "Safety car is out." : `Gap ahead ${input.gapAhead.toFixed(1)}s, behind ${input.gapBehind.toFixed(1)}s.`}`,
    },
    {
      role: "driver",
      text: input.tyreAge > 15 ? "Rear is starting to go away. The traction is falling off." : "Tyres are still underneath me — happy to stay out.",
    },
    { role: "engineer", text: call },
    {
      role: "driver",
      text: best.stops > 0 ? `Understood. Box on lap ${best.stops > 0 ? best.stints[0].toLap + 1 : "—"}.` : "Understood. Staying out.",
    },
  ];

  return { options, baseline: baseline.totalTime, call, transcript, undercut };
}
