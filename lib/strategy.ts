export type Compound = "soft" | "medium" | "hard" | "inter" | "wet";
export type CircuitKey =
  | "albert_park"
  | "shanghai"
  | "suzuka"
  | "miami"
  | "villeneuve"
  | "monaco"
  | "catalunya"
  | "red_bull_ring"
  | "hungaroring"
  | "madring"
  | "baku"
  | "sepang"
  | "americas"
  | "rodriguez"
  | "interlagos"
  | "las_vegas"
  | "monza"
  | "marina_bay"
  | "silverstone"
  | "spa"
  | "yas_marina"
  | "zandvoort"
  | "qatar";

export type CircuitProfile = {
  name: string;
  laps: number;
  baseLap: number;
  pitLoss: number;
  abrasion: number;
  overtaking: "easy" | "medium" | "hard";
  /** Stops the circuit forces — a rule or a tyre that cannot go the distance.
   *  Shorter plans are not priced at all, instead of being priced and written off. */
  minStops?: number;
  note: string;
};

export const CIRCUITS: Record<CircuitKey, CircuitProfile> = {
  albert_park: {
    name: "Albert Park",
    laps: 58,
    baseLap: 82.5,
    pitLoss: 21.5,
    abrasion: 1.0,
    overtaking: "medium",
    note: "Resurfaced and fast, with a cheap stop: the undercut is live, and the front-left pays for the high-speed sweepers.",
  },
  shanghai: {
    name: "Shanghai",
    laps: 56,
    baseLap: 95.8,
    pitLoss: 23.0,
    abrasion: 1.25,
    overtaking: "medium",
    note: "The long front-left corners grain the tyre early; the back straight is the only place to undo a bad stop.",
  },
  suzuka: {
    name: "Suzuka",
    laps: 53,
    baseLap: 92.8,
    pitLoss: 22.5,
    abrasion: 1.35,
    overtaking: "hard",
    note: "The esses put a continuous load through the front-left, so one stop is a stretch and two is the default.",
  },
  miami: {
    name: "Miami",
    laps: 57,
    baseLap: 92.2,
    pitLoss: 22.0,
    abrasion: 1.05,
    overtaking: "medium",
    note: "A street-style layout with one long straight: traction out of the slow corners decides tyre life.",
  },
  villeneuve: {
    name: "Villeneuve",
    laps: 70,
    baseLap: 74.6,
    pitLoss: 19.5,
    abrasion: 0.85,
    overtaking: "easy",
    note: "Braking, traction and a very short pit lane — the cheapest stop on the calendar makes the undercut automatic.",
  },
  monaco: {
    name: "Monaco",
    laps: 78,
    baseLap: 75.2,
    pitLoss: 21.0,
    abrasion: 0.6,
    overtaking: "hard",
    note: "Degradation is barely a factor; track position and the timing of a safety car decide the race.",
  },
  catalunya: {
    name: "Catalunya",
    laps: 66,
    baseLap: 78.6,
    pitLoss: 22.0,
    abrasion: 1.3,
    overtaking: "medium",
    note: "The long right-handers in the final sector turn this into a front-left management race.",
  },
  red_bull_ring: {
    name: "Red Bull Ring",
    laps: 71,
    baseLap: 67.7,
    pitLoss: 19.0,
    abrasion: 0.9,
    overtaking: "easy",
    note: "A short lap with a cheap stop and three DRS zones: track position is easy to lose and easy to regain.",
  },
  hungaroring: {
    name: "Hungaroring",
    laps: 70,
    baseLap: 78.9,
    pitLoss: 21.0,
    abrasion: 1.2,
    overtaking: "hard",
    note: "Hot, twisty and with almost no straight to cool the tyres — passing is hard, so the stop must be earned.",
  },
  madring: {
    name: "Madring",
    laps: 57,
    baseLap: 92.0,
    pitLoss: 22.0,
    abrasion: 1.05,
    overtaking: "medium",
    // New circuit with no race history yet: kept at a neutral street-circuit
    // estimate rather than pretending to a measured abrasion figure.
    note: "A new Madrid layout with no race history, so its pit loss and wear sit at a neutral street-circuit estimate.",
  },
  baku: {
    name: "Baku",
    laps: 51,
    baseLap: 105.1,
    pitLoss: 20.5,
    abrasion: 0.7,
    overtaking: "easy",
    note: "Smooth asphalt and a huge slipstream: the tyres last, and the tow down the main straight is the passing tool.",
  },
  sepang: {
    name: "Sepang",
    laps: 56,
    baseLap: 96.3,
    pitLoss: 23.5,
    abrasion: 1.35,
    overtaking: "medium",
    note: "Heat and two long fast corners punish the rears; the long pit lane makes each stop expensive.",
  },
  americas: {
    name: "Circuit of the Americas",
    laps: 56,
    baseLap: 98.4,
    pitLoss: 22.0,
    abrasion: 1.2,
    overtaking: "medium",
    note: "The esses load the front-left and the bumps unsettle the rear; the back straight is the reward.",
  },
  rodriguez: {
    name: "Rodriguez",
    laps: 71,
    baseLap: 79.9,
    pitLoss: 20.5,
    abrasion: 0.8,
    overtaking: "easy",
    note: "Thin air at altitude cools the tyres and the brakes; the run to Turn 1 is the only real passing chance.",
  },
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
  qatar: {
    name: "Lusail",
    laps: 57,
    baseLap: 84.6,
    pitLoss: 25.0,
    abrasion: 1.4,
    overtaking: "medium",
    // One stint cannot legally or physically cover this race; the long,
    // loaded corners cook the rears well before half distance.
    minStops: 2,
    note: "Lusail is a two-stop circuit: the high-speed load overheats the rears and a single stint does not go the distance.",
  },
};

type CompoundMeta = { label: string; offset: number; deg: number; life: number; code: string };

/** `life` is the lap count at abrasion 1.0 — see tyreLife for the per-circuit figure. */
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

/** How many laps a compound lasts at a circuit's abrasion, cliff included.
 *
 *  Abrasion moves the clock, not the total: a tyre that loses time 40% faster
 *  reaches its cliff in about 1/1.4 of the laps, so the penalty banked by the
 *  end of the stint stays put while a high-abrasion race needs more stops than
 *  a smooth one. Wets run a shorter life than the dry tyres they replace. */
export function tyreLife(compound: Compound, abrasion: number): number {
  const info = meta(compound);
  const wet = compound === "inter" || compound === "wet";
  return Math.max(8, Math.round((info.life / Math.max(0.4, abrasion)) * (wet ? 0.85 : 1)));
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
  const cliff = tyreLife(compound, circuit.abrasion);
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
  /** A safety car expected inside these laps, rather than one on track right now.
   *  The forecast prices the stop cheaply only if it falls in the window. */
  safetyCarWindow?: { from: number; to: number };
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

/** What a lap spent stuck behind a car costs, by how hard passing is. */
export const DIRTY_AIR: Record<CircuitProfile["overtaking"], number> = {
  easy: 0.12,
  medium: 0.3,
  hard: 0.55,
};

/** The neutral car's stops: evenly spaced, as many as the tyre life forces. */
function neutralStops(circuit: CircuitProfile, totalLaps: number): number[] {
  const natural =
    circuit.minStops ?? (tyreLife("hard", circuit.abrasion) * 1.15 < totalLaps ? 2 : 1);
  const count = Math.max(1, natural);
  return Array.from({ length: count }, (_, index) =>
    Math.round(((index + 1) * totalLaps) / (count + 1)),
  );
}

/** Cumulative race time of the neutral car, lap by lap from the same start.
 *
 *  This is the other half of an undercut: without a rival, an extra second of
 *  clean air is worth nothing, so the optimiser always takes the balanced split.
 *  The rival stops where the tyre life says a sensible car stops, and every lap
 *  our plan spends behind it is charged at the circuit's cost of following. */
function neutralTimeline(circuit: CircuitProfile, input: StrategyInput): number[] {
  const stops = new Map(neutralStops(circuit, input.totalLaps).map((lap) => [lap, "medium" as Compound]));
  const timeline: number[] = [];
  let cumulative = 0;
  let compound: Compound = input.compound === "inter" || input.compound === "wet" ? input.compound : "medium";
  let age = 0;
  for (let lap = input.lap; lap <= input.totalLaps; lap += 1) {
    if (stops.has(lap) && lap > 1) {
      cumulative += circuit.pitLoss;
      compound = stops.get(lap) as Compound;
      age = 0;
    }
    cumulative += lapTime(circuit, compound, age, input.trackTemp, input.rain);
    age += 1;
    timeline.push(cumulative);
  }
  return timeline;
}

type Plan = { stops: Array<{ lap: number; compound: Compound }> };

function simulate(input: StrategyInput, circuit: CircuitProfile, plan: Plan): StrategyOption {
  const stints: Stint[] = [];
  const notes: string[] = [];
  let total = 0;
  let compound = input.compound;
  let age = input.tyreAge;
  let stintStart = Math.max(1, input.lap - input.tyreAge);
  let stopsDone = 0;
  const perLap: number[] = [];
  const pitLaps = new Map(plan.stops.map((stop) => [stop.lap, stop.compound]));
  const window = input.safetyCarWindow;
  // A forecasted safety car is only cheap while it is actually out; a flag on
  // track right now still covers the next few laps from the current one.
  const cheapStop = (lap: number) =>
    window
      ? lap >= window.from && lap <= window.to
      : input.safetyCar && lap <= input.lap + 3;

  for (let lap = input.lap; lap <= input.totalLaps; lap += 1) {
    if (pitLaps.has(lap) && lap > 1) {
      stints.push({ compound, fromLap: stintStart, toLap: lap - 1 });
      const loss = cheapStop(lap) ? circuit.pitLoss * 0.42 : circuit.pitLoss;
      total += loss;
      stopsDone += 1;
      compound = pitLaps.get(lap) as Compound;
      age = 0;
      stintStart = lap;
      if (cheapStop(lap)) {
        notes.push(
          window
            ? `Stop on lap ${lap} falls inside the safety-car window: pit loss drops to roughly 40% of a green-flag stop.`
            : "Safety car on track: pit loss drops to roughly 40% of a green-flag stop.",
        );
      }
      if (input.gapBehind < 2.2 && lap === input.lap) {
        notes.push("Rejoining in traffic — you will lose around 1.2s behind the car you just covered.");
        total += 1.2;
      }
    }
    total += lapTime(circuit, compound, age, input.trackTemp, input.rain);
    age += 1;
    perLap.push(total);
  }
  stints.push({ compound, fromLap: stintStart, toLap: input.totalLaps });

  // Two-car undercut: pay for the laps spent in the dirty air of the neutral
  // car. A plan that stops early gets clean air; a plan that waits inherits the
  // traffic it rejoins into, which is the cost a one-car model cannot see.
  const rival = neutralTimeline(circuit, input);
  let behindLaps = 0;
  for (let index = 0; index < perLap.length; index += 1) {
    if (perLap[index] > rival[index] + 0.5) behindLaps += 1;
  }
  const trafficCost = behindLaps * DIRTY_AIR[circuit.overtaking];
  if (trafficCost >= 0.5) {
    total += trafficCost;
    notes.push(
      `Track position: ${behindLaps} laps in the dirty air of the neutral car, charged at ${DIRTY_AIR[circuit.overtaking].toFixed(2)}s a lap because passing is ${circuit.overtaking} here.`,
    );
  }

  const finalCompound = stints[stints.length - 1].compound;
  // Every stint is checked, not just the last one. A first stint 8 laps past the
  // cliff costs the same as a last one, and on a high-abrasion circuit it is how
  // an over-long one-stop wins on paper.
  let overLife = 0;
  let overStint: Stint | null = null;
  for (const stint of stints) {
    const laps = stint.toLap - stint.fromLap + 1;
    const over = Math.max(0, laps - tyreLife(stint.compound, circuit.abrasion));
    if (over > overLife) {
      overLife = over;
      overStint = stint;
    }
  }

  if (overStint) {
    const laps = overStint.toLap - overStint.fromLap + 1;
    const life = tyreLife(overStint.compound, circuit.abrasion);
    notes.push(
      `${laps} laps on the ${meta(overStint.compound).label.toLowerCase()} is ${overLife} past its ${life}-lap cliff at this circuit — that stint gives away time before the stop.`,
    );
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

/** Price one explicit pit plan. Used by the race forecast, which enumerates
 *  windows across the whole race rather than a 30-lap horizon from now. */
export function pricePlan(
  input: StrategyInput,
  stops: Array<{ lap: number; compound: Compound }>,
): StrategyOption {
  const circuit = CIRCUITS[input.circuit];
  const totalLaps = Math.min(input.totalLaps, circuit.laps);
  return simulate({ ...input, totalLaps }, circuit, { stops });
}

/** Price a plan against an explicit circuit profile (used for circuits with no
 *  bespoke entry in CIRCUITS, which the forecast builds from calendar metadata). */
export function pricePlanOn(
  profile: CircuitProfile,
  input: StrategyInput,
  stops: Array<{ lap: number; compound: Compound }>,
): StrategyOption {
  const totalLaps = Math.min(input.totalLaps, profile.laps);
  return simulate({ ...input, totalLaps }, profile, { stops });
}
