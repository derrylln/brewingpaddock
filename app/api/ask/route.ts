import { NextResponse } from "next/server";
import { polishAnswer } from "@/lib/ai-reads";
import { answerQuestion } from "@/lib/knowledge";
import { LIMITS, guard, withGuardHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await guard(request, "ai", LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!gate.ok) return gate.response;
  const hourly = await guard(request, "ai-hour", LIMITS.aiHourly.limit, LIMITS.aiHourly.windowMs);
  if (!hourly.ok) return hourly.response;

  try {
    const body = (await request.json()) as { question?: string };
    const question = (body.question ?? "").slice(0, 400);

    // Retrieval and arithmetic stay deterministic; the model only phrases the
    // result, and only from the grounded answer it is handed.
    const base = await answerQuestion(question);
    const polish = await polishAnswer(question, base);

    return withGuardHeaders(
      NextResponse.json({
        ...base,
        answer: polish?.text ?? base.answer,
        source: polish ? "ai" : "model",
        model: polish?.model ?? null,
      }),
      gate,
    );
  } catch (error) {
    console.error("[ask] failed", error);
    return NextResponse.json(
      { error: "That question could not be grounded in the data." },
      { status: 502 },
    );
  }
}
