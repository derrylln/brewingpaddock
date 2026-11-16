import { NextResponse } from "next/server";
import { polishAnswer } from "@/lib/ai-reads";
import { answerQuestion } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = (body.question ?? "").slice(0, 400);

    // Retrieval and arithmetic stay deterministic; the model only phrases the
    // result, and only from the grounded answer it is handed.
    const base = await answerQuestion(question);
    const polish = await polishAnswer(question, base);

    return NextResponse.json({
      ...base,
      answer: polish?.text ?? base.answer,
      source: polish ? "ai" : "model",
      model: polish?.model ?? null,
    });
  } catch (error) {
    console.error("[ask] failed", error);
    return NextResponse.json(
      { error: "That question could not be grounded in the data." },
      { status: 502 },
    );
  }
}
