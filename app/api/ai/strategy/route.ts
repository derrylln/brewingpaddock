import { NextResponse } from "next/server";
import { strategyRead } from "@/lib/ai-reads";
import {
  CIRCUITS,
  buildStrategies,
  type CircuitKey,
  type Compound,
  type Rain,
  type StrategyInput,
} from "@/lib/strategy";

export const dynamic = "force-dynamic";

const COMPOUNDS: Compound[] = ["soft", "medium", "hard", "inter", "wet"];
const RAINS: Rain[] = ["dry", "drying", "light", "heavy"];

function num(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The client sends the scenario it is showing; the server recomputes the plan
 * with the same model before asking the LLM to read it, so the generated text
 * can never describe numbers the simulator did not produce.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const circuit = (
      typeof body.circuit === "string" && body.circuit in CIRCUITS ? body.circuit : "interlagos"
    ) as CircuitKey;
    const profile = CIRCUITS[circuit];
    const totalLaps = profile.laps;

    const input: StrategyInput = {
      circuit,
      totalLaps,
      lap: Math.round(num(body.lap, 2, totalLaps - 2, Math.round(totalLaps * 0.35))),
      compound: (COMPOUNDS.includes(body.compound as Compound) ? body.compound : "medium") as Compound,
      tyreAge: Math.round(num(body.tyreAge, 0, Math.min(45, totalLaps - 2), 12)),
      gapAhead: Number(num(body.gapAhead, 0, 12, 1.2).toFixed(1)),
      gapBehind: Number(num(body.gapBehind, 0, 12, 3.4).toFixed(1)),
      safetyCar: body.safetyCar === true,
      trackTemp: Math.round(num(body.trackTemp, 8, 56, 34)),
      rain: (RAINS.includes(body.rain as Rain) ? body.rain : "dry") as Rain,
    };

    const result = buildStrategies(input);
    const read = await strategyRead(input, result);
    return NextResponse.json({ read, circuit: profile.name, lap: input.lap });
  } catch (error) {
    console.error("[ai/strategy] failed", error);
    return NextResponse.json({ error: "The strategist could not read that scenario." }, { status: 502 });
  }
}
