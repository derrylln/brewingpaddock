import { aiText } from "@/lib/ai";
import { cached } from "@/lib/cache";
import { eventDocuments, type FiaDocument } from "@/lib/fia-reports";
import type { Prediction, PredictionRow } from "@/lib/predict";

/**
 * FYI lines for the predictor, carried over from the papers page.
 *
 * `/papers` has already had every FIA document read once by the daily job
 * (`scripts/fia-reports.mjs`) and saved into `data/fia-reports.json`. This does
 * not re-read the PDFs: it takes that finished reading, matches each document to
 * the drivers it affects, and asks a cheaper follow-up model for one plain
 * sentence per driver — an upgrade that could add pace, a grid penalty, a
 * power-unit change.
 *
 * The notes annotate the grid. They are never fed into the simulation numbers,
 * which stay a pure function of the classification data.
 */

export type PapersNote = {
  code: string;
  text: string;
  source: "ai" | "papers";
  model: string | null;
};

export type PapersNotes = {
  items: PapersNote[];
  model: string | null;
};

/**
 * The follow-up only rewrites readings that already exist, so the lite sibling
 * carries it and the default model is kept for the reads that do the reading.
 */
const NOTES_MODEL = "gemini-3.1-flash-lite";

/** Procedural paperwork is not an FYI; only consequences are. */
const RELEVANT = new Set<FiaDocument["impact"]>(["upgrade", "power-unit", "penalty", "decision"]);

/** The papers and Ergast disagree on a couple of constructor ids. */
const SAME_TEAM: Record<string, string> = {
  rb: "racing_bulls",
  racing_bulls: "rb",
  sauber: "audi",
  audi: "sauber",
};

const SYSTEM = `You write short FYI lines for a race-prediction page from FIA documents that have already been read and classified.
Return ONLY JSON, no markdown fence: {"notes":[{"code":"VER","text":"string"}]}
Rules:
- One note per driver code supplied, at most 22 words, plain British English.
- Say what the paperwork means for that driver this weekend: a new part that could add pace, a grid penalty, a power-unit change, or a stewards' decision. Name the part or the penalty concretely.
- Use only the supplied documents. Never invent a part, a number or a penalty.
- If a driver's documents are only procedural, omit that code entirely — an empty list is a valid answer.
- No "FYI" prefix, no emoji, no markdown, no headings, no restating the race name.`;

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function docsFor(row: PredictionRow, documents: FiaDocument[]): FiaDocument[] {
  return documents.filter((doc) => {
    // A document that names cars or drivers is about those drivers only: a
    // power-unit penalty on one car is not news for their team-mate. Only a
    // team-wide reading (an upgrade with no driver named) covers both cars.
    if (doc.drivers?.length) return doc.drivers.includes(row.code);
    if (!doc.team || !row.teamId) return false;
    return doc.team === row.teamId || SAME_TEAM[doc.team] === row.teamId;
  });
}

/** Strongest consequence first, so the fallback line quotes the one that matters. */
function weightOf(doc: FiaDocument): number {
  if (doc.impact === "penalty" || doc.impact === "power-unit") return 0;
  if (doc.impact === "upgrade") return 1;
  return 2;
}

/**
 * No key, no budget or a broken reply still leaves useful notes: the papers' own
 * written detail is already plain English, so it can stand in unedited.
 */
function fromPapers(row: PredictionRow, documents: FiaDocument[]): PapersNote {
  const best = [...documents].sort((a, b) => weightOf(a) - weightOf(b))[0];
  const text = (best.detail || best.headline || best.title).replace(/\s+/g, " ").trim();
  return {
    code: row.code,
    text: text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text,
    source: "papers",
    model: null,
  };
}

export async function papersNotes(prediction: Prediction): Promise<PapersNotes> {
  const documents = eventDocuments()
    .filter((doc) => RELEVANT.has(doc.impact) && doc.significance !== "low")
    .slice(0, 20);
  if (documents.length === 0) return { items: [], model: null };

  const matched = prediction.rows
    .map((row) => ({ row, docs: docsFor(row, documents) }))
    .filter((entry) => entry.docs.length > 0);
  if (matched.length === 0) return { items: [], model: null };

  const round = prediction.race.round;
  return cached<PapersNotes>(`papers:notes:v1:${round}`, 15 * 60_000, async () => {
    const fallback = matched.map(({ row, docs }) => fromPapers(row, docs));
    const data = {
      race: prediction.race.name,
      drivers: matched.map(({ row, docs }) => ({
        code: row.code,
        team: row.team,
        documents: docs.map((doc) => ({
          impact: doc.impact,
          significance: doc.significance,
          title: doc.headline || doc.title,
          detail: doc.detail,
        })),
      })),
    };

    const completion = await aiText({
      model: NOTES_MODEL,
      system: SYSTEM,
      user: `DATA\n${JSON.stringify(data)}\n\nTASK\nWrite the FYI lines.`,
      maxTokens: 700,
      temperature: 0.2,
    });
    if (!completion) return { items: fallback, model: null };

    let parsed: unknown;
    try {
      parsed = parseJson(completion.text);
    } catch {
      return { items: fallback, model: completion.model };
    }

    const known = new Set(matched.map(({ row }) => row.code));
    const notes = Array.isArray((parsed as { notes?: unknown }).notes)
      ? ((parsed as { notes: unknown[] }).notes ?? [])
      : [];
    const items: PapersNote[] = [];
    for (const entry of notes) {
      const row = entry as { code?: unknown; text?: unknown };
      const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
      const text = typeof row.text === "string" ? row.text.replace(/\s+/g, " ").trim() : "";
      if (!known.has(code) || text.length < 12 || items.some((note) => note.code === code)) continue;
      items.push({
        code,
        text: text.length > 200 ? `${text.slice(0, 197).trimEnd()}…` : text,
        source: "ai",
        model: completion.model,
      });
    }

    // A model that returned nothing usable is a failed follow-up, not a quiet
    // weekend: fall back to the papers' own wording rather than showing nothing.
    if (items.length === 0) return { items: fallback, model: completion.model };
    return { items, model: completion.model };
  });
}
