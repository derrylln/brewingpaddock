#!/usr/bin/env node
/**
 * Pull the FIA's published documents for the next race and write
 * `data/fia-reports.json` for the Papers page.
 *
 * The FIA has no API. Each event has a server-rendered page at
 * `/documents/decision-documents/event/<Event Name>` that lists every PDF for
 * that Grand Prix, so that page is the source of truth. PDFs are downloaded,
 * their text extracted with unpdf, and the whole batch classified in a single
 * model call — one call per run, results saved, never called again for the same
 * document.
 *
 * Without an API key (or if the call fails) the documents still land in the
 * JSON with a title-and-text rule classification tagged `rules`, so the page
 * works and the daily job never breaks.
 *
 * Usage:
 *   node scripts/fia-reports.mjs            # next race from data/snapshot.json
 *   FIA_EVENT="Las Vegas Grand Prix" node scripts/fia-reports.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "fia-reports.json");
const SNAPSHOT_FILE = path.join(ROOT, "data", "snapshot.json");
const FIA = "https://www.fia.com";
const UA = "BrewingPaddock/1.0 (+https://github.com/derrylln/brewingpaddock)";
/** Polite ceiling: a race weekend can add 60+ documents, but not all at once. */
const MAX_NEW_PDFS = 16;
const MAX_TEXT = 2_400;
const MAX_KEPT_DOCS = 90;

const TEAMS = [
  ["McLaren", "mclaren"],
  ["Mercedes", "mercedes"],
  ["Red Bull", "red_bull"],
  ["Ferrari", "ferrari"],
  ["Williams", "williams"],
  ["Racing Bulls", "racing_bulls"],
  ["RB", "rb"],
  ["Aston Martin", "aston_martin"],
  ["Haas", "haas"],
  ["Audi", "audi"],
  ["Sauber", "sauber"],
  ["Alpine", "alpine"],
  ["Cadillac", "cadillac"],
];

const log = (...args) => console.log("[fia]", ...args);

async function get(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...(opts.headers ?? {}) },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText} for ${url}`);
    error.status = res.status;
    throw error;
  }
  return res;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** The FIA rate-limits a burst of PDFs; back off instead of losing the text. */
async function getWithRetry(url, opts = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await get(url, opts);
    } catch (error) {
      if (!RETRYABLE_STATUS.has(error.status) || attempt === attempts) throw error;
      log(`${url.split("/").pop()} -> ${error.status}, retrying in ${attempt * 2}s`);
      await sleep(attempt * 2_000);
    }
  }
  throw new Error(`unreachable: ${url}`);
}

/* ------------------------------------------------------------------ */
/* Race + event resolution                                             */
/* ------------------------------------------------------------------ */

function nextRace(snapshot) {
  const now = Date.now() - 6 * 3600_000; // a race weekend runs into Monday
  const upcoming = snapshot.schedule.find((race) => Date.parse(`${race.date}T12:00:00Z`) > now);
  return upcoming ?? snapshot.schedule[snapshot.schedule.length - 1];
}

/** The FIA names events its own way; map the ones Ergast spells differently. */
const EVENT_ALIASES = {
  interlagos: ["São Paulo Grand Prix", "Brazilian Grand Prix"],
  monza: ["Italian Grand Prix"],
  silverstone: ["British Grand Prix"],
  spa: ["Belgian Grand Prix"],
  zandvoort: ["Dutch Grand Prix"],
  baku: ["Azerbaijan Grand Prix"],
  imola: ["Emilia-Romagna Grand Prix"],
  spielberg: ["Austrian Grand Prix"],
  montreal: ["Canadian Grand Prix", "Montréal"],
  monaco: ["Monaco Grand Prix", "Monaco"],
  jeddah: ["Saudi Arabian Grand Prix"],
  losail: ["Qatar Grand Prix"],
  yas_marina: ["Abu Dhabi Grand Prix"],
  vegas: ["Las Vegas Grand Prix"],
  mexico: ["Mexico City Grand Prix"],
  austin: ["United States Grand Prix"],
  suzuka: ["Japanese Grand Prix"],
  shanghai: ["Chinese Grand Prix"],
  melbourne: ["Australian Grand Prix"],
  bahrain: ["Bahrain Grand Prix"],
  singapore: ["Singapore Grand Prix"],
  madrid: ["Spanish Grand Prix"],
  barcelona: ["Spanish Grand Prix"],
};

function normalise(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseEventOptions(html) {
  const options = new Map();
  for (const match of html.matchAll(/<option value="\/documents\/decision-documents\/event\/([^"]+)">([^<]+)<\/option>/g)) {
    options.set(decodeURIComponent(match[2]).trim(), decodeURIComponent(match[1]));
  }
  return options;
}

function pickEvent(snapshotRace, options) {
  const wanted = snapshotRace.raceName;
  const exact = options.get(wanted);
  if (exact) return { name: wanted, slug: exact };

  for (const alias of EVENT_ALIASES[snapshotRace.Circuit.circuitId] ?? []) {
    if (options.has(alias)) return { name: alias, slug: options.get(alias) };
  }

  // Last resort: the option sharing the most words with the Ergast name.
  const target = new Set(normalise(wanted).split(" "));
  let best = null;
  for (const [name, slug] of options) {
    const score = normalise(name)
      .split(" ")
      .filter((word) => target.has(word)).length;
    if (score >= 2 && (!best || score > best.score)) best = { name, slug, score };
  }
  if (best) return best;

  // The FIA page also accepts a plain guess, which may still resolve.
  return { name: wanted, slug: wanted };
}

/* ------------------------------------------------------------------ */
/* Document list parsing                                               */
/* ------------------------------------------------------------------ */

function parseDate(label) {
  const match = label.match(/(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return { iso: null, label };
  const [, dd, mm, yy, hh, min] = match;
  return {
    iso: `20${yy}-${mm}-${dd}T${hh}:${min}:00+01:00`,
    label: `${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm) - 1]} · ${hh}:${min}`,
  };
}

function parseDocuments(html) {
  const docs = [];
  for (const chunk of html.split('<li class="document-row').slice(1)) {
    const href = chunk.match(/<a href="([^"]+)"[^>]*download/)?.[1];
    if (!href || !href.endsWith(".pdf")) continue;
    const rawTitle = chunk.match(/<div class="title">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const title = rawTitle.replace(/\s+/g, " ").trim();
    if (!title) continue;
    const dateLabel = chunk.match(/class="date-display-single">([^<]*)</)?.[1] ?? "";
    const { iso, label } = parseDate(dateLabel);
    const number = title.match(/^Doc\s+(\d+)\s*[-–]\s*/i)?.[1] ?? null;
    const url = href.startsWith("http") ? href : `${FIA}${href}`;
    const id = path.basename(new URL(url).pathname, ".pdf");
    docs.push({
      id,
      doc: number ? Number(number) : null,
      title: title.replace(/^Doc\s+\d+\s*[-–]\s*/i, ""),
      rawTitle: title,
      url,
      publishedAt: iso,
      publishedLabel: label,
    });
  }
  return docs;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

function carsFrom(snapshot) {
  const cars = new Map();
  for (const row of snapshot.standings ?? []) {
    const number = Number(row.driver?.permanentNumber);
    if (!Number.isFinite(number)) continue;
    cars.set(number, {
      code: row.driver?.code ?? null,
      driver: `${row.driver?.givenName ?? ""} ${row.driver?.familyName ?? ""}`.trim(),
      constructorId: row.constructor?.constructorId ?? null,
      team: row.constructor?.name ?? null,
    });
  }
  return cars;
}

function detectTeam(text, teamsById) {
  for (const [needle, id] of TEAMS) {
    if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      return { id, label: teamsById.get(id) ?? needle };
    }
  }
  return { id: null, label: null };
}

/** A grounded, generic line for documents that are tables rather than prose. */
function synthDetail(doc) {
  const event = doc.eventName ?? "the race";
  const title = doc.title.toLowerCase();
  if (/power unit/.test(title)) {
    return `The FIA's power-unit element sheet for the ${event}: which engines, turbos and control electronics each driver has used. A new element beyond the allocation is what turns into a grid penalty.`;
  }
  if (/pirelli|competition notes/.test(title)) {
    return `The weekend's competition notes and Pirelli preview for the ${event} — tyre allocation, starting pressures and the sporting ground rules.`;
  }
  if (/competition visa|entry list/.test(title)) {
    return `The FIA's entry paperwork for the ${event}: the teams, drivers and officials cleared to take part.`;
  }
  if (/classification|starting grid|championship points/.test(title)) {
    return `Official ${doc.title.toLowerCase()} for the ${event}, published by the FIA after the session.`;
  }
  if (/scrutineer|technical/.test(title)) {
    return `The technical delegate's checks on the cars at the ${event} — legality, software and safety systems.`;
  }
  return `${doc.title} for the ${event}, published by the FIA.`;
}

function rulesDoc(doc, text, cars, teamsById) {
  const haystack = `${doc.title}\n${text}`;
  const carNumbers = [...haystack.matchAll(/\bCar\s+(\d{1,3})\b/gi)].map((m) => Number(m[1]));
  const driver = carNumbers.map((n) => cars.get(n)).find(Boolean) ?? null;

  // The addressee is the most reliable team signal; then the car's entrant.
  const managerLine = text.match(/To The Team Manager,\s*([^\n.]+)/i)?.[1] ?? "";
  const byManager = managerLine ? detectTeam(managerLine, teamsById) : { id: null, label: null };
  const byCar = driver?.constructorId
    ? { id: driver.constructorId, label: driver.team ?? teamsById.get(driver.constructorId) ?? null }
    : { id: null, label: null };
  const byTitle = detectTeam(doc.title, teamsById);
  const teamHit = [byManager, byCar, byTitle, detectTeam(text, teamsById)].find((hit) => hit.id) ?? {
    id: null,
    label: null,
  };

  const title = doc.title.toLowerCase();
  let impact = "other";
  if (/upgrade|upgraded|new.*floor|new.*wing|new.*package|introduc|homologat/.test(title)) impact = "upgrade";
  else if (/infringement|penalt|breach|unsafe release|impeding/.test(title)) impact = "penalty";
  else if (/power unit|pu element|grid penalty/.test(title)) impact = "power-unit";
  else if (/scrutineer|technical delegate|parc ferme|technical check/.test(title)) impact = "scrutineering";
  else if (/summons|decision|steward/.test(title)) impact = "decision";
  else if (/classification|starting grid|championship points/.test(title)) impact = "result";
  else if (/timetable|competition notes|circuit map|pirelli preview|procedure|visa/.test(title)) impact = "briefing";
  else if (/entry list|driver|replacement/.test(title)) impact = "entry";

  let significance = "low";
  if (impact === "penalty" || impact === "power-unit" || impact === "upgrade") significance = "medium";
  if (/causing a collision|disqualif|grid penalty|unsafe release|new power unit|engine change/i.test(haystack)) {
    significance = "high";
  }

  // Strip the document header block, which repeats the event, sender and
  // document number before the part a fan actually wants.
  let body = text.replace(/\s+/g, " ");
  const start = body.search(/The Stewards (?:having|have|received|considered)|Having considered|The Stewards determined/i);
  if (start > 40) body = body.slice(start);
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .filter(
      (line) =>
        line.length > 50 &&
        !/^(?:\d{4} .*GRAND PRIX|From The|To The|Document \d|Date \d|Time \d|Title |Description |Enclosed )/i.test(line) &&
        !/GRAND PRIX\s+\d{2}\s*-\s*\d{2}\s+\w+\s+\d{4}/.test(line),
    );
  const words = sentences.join(" ").split(/\s+/);
  const numeric = words.filter((word) => /^[\d.,:/-]+$/.test(word)).length;
  // Table-heavy sheets (PU elements, pressures, classifications) read as noise;
  // say what the document is instead of quoting columns.
  const tableHeavy = words.length === 0 || numeric / words.length > 0.28;
  const tabular =
    impact === "briefing" || impact === "power-unit" || impact === "result" || impact === "entry";
  const firstSentences = tableHeavy || tabular ? "" : sentences.slice(0, 2).join(" ");

  return {
    impact,
    team: teamHit.id,
    teamLabel: teamHit.label,
    drivers: driver?.code ? [driver.code] : [],
    headline: doc.title,
    detail: firstSentences.slice(0, 320) || synthDetail(doc),
    significance,
    source: "rules",
  };
}

/** The model names a constructor; the site needs the stable team id. */
function teamIdFrom(name, teamsById) {
  if (!name) return null;
  const norm = normalise(name);
  for (const [id, label] of teamsById) {
    if (norm === normalise(label) || norm.includes(normalise(label))) return id;
  }
  for (const [needle, id] of TEAMS) {
    if (norm.includes(normalise(needle))) return id;
  }
  return null;
}

function aiKey() {
  return (
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.AI_API_KEY ??
    ""
  ).trim();
}

function aiBase() {
  return (
    (process.env.AI_API_BASE ?? "").trim() ||
    "https://generativelanguage.googleapis.com/v1beta/openai"
  ).replace(/\/+$/, "");
}

const DOC_SYSTEM = `You classify official FIA Formula 1 documents for a race-preview site.
Return ONLY JSON, no markdown fence, matching:
{"documents":[{"id":string,"impact":"upgrade"|"penalty"|"power-unit"|"scrutineering"|"decision"|"result"|"briefing"|"entry"|"other","team":string|null,"drivers":string[],"headline":string,"detail":string,"significance":"high"|"medium"|"low"}]}
Rules:
- Return one entry for EVERY id you are given, exactly once, with that exact id string. Never merge, skip or invent documents.
- "headline" is at most 12 words of plain English, no document jargon.
- "detail" is 1-2 sentences a casual fan understands, naming the team/driver and the consequence when known.
- team must be the constructor name exactly as in the text, or null if no team is identified. Never guess.
- drivers are three-letter codes (VER, NOR) only when the document names the car or driver.
- impact "power-unit" means power-unit element usage that risks or confirms a grid penalty; "scrutineering" is technical checks; "result" is classifications/grids/points.
- significance "high" only for a likely race-altering consequence (grid penalty, disqualification, major upgrade).`;

const READ_SYSTEM = `You write the paddock read for a race-preview site from already-classified FIA documents.
Return ONLY JSON, no markdown fence: {"read":string,"teams":[{"team":string,"flag":"upgrade"|"penalty"|"info","note":string}]}
Rules:
- "read" is 2-3 sentences on what the paperwork means for the race: who brings performance, who is likely to take a grid penalty, what the stewards are watching. Use only the supplied documents; never invent a team, number or penalty.
- "teams" lists at most 6 constructors with a one-line note, most consequential first. Use [] when nothing stands out.`;

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
const CHUNK_DOCS = 6;
const CHUNK_CHARS = 11_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * One model call with a real retry path: every model is tried, then the whole
 * attempt is repeated. Returns null only after all attempts are exhausted.
 */
async function callModel(
  system,
  user,
  { maxTokens = 2_200, attempts = Number(process.env.AI_ATTEMPTS) || 3 } = {},
) {
  const key = aiKey();
  if (!key) return null;
  const base = aiBase();
  const gemini = /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(base);
  const models = [...new Set([(process.env.AI_MODEL ?? "").trim() || MODELS[0], ...MODELS])];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const model of models) {
      const body = {
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      if (gemini) body.reasoning_effort = "minimal";

      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 200);
          log(`ai ${model} -> ${res.status} ${detail}`);
          // An endpoint that rejects reasoning_effort still answers without it.
          if (res.status === 400 && /reasoning_effort|thinking/i.test(detail)) body.reasoning_effort = undefined;
          continue;
        }
        const data = await res.json();
        const raw = (data.choices?.[0]?.message?.content ?? "").trim();
        if (!raw) {
          log(`ai ${model} -> empty response`);
          continue;
        }
        return { json: parseJson(raw), model };
      } catch (error) {
        log(`ai ${model} attempt ${attempt} failed: ${error.message}`);
      }
    }
    if (attempt < attempts) await sleep(1_500 * attempt);
  }
  return null;
}

/** Keep each request inside a comfortable context and token budget. */
function chunkDocs(docs) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const doc of docs) {
    const size = (doc.text ?? "").length + 300;
    if (current.length > 0 && (current.length >= CHUNK_DOCS || chars + size > CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(doc);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function classifyChunk(event, docs) {
  const said = await callModel(
    DOC_SYSTEM,
    JSON.stringify({
      event,
      documents: docs.map((doc) => ({
        id: doc.id,
        title: doc.rawTitle ?? doc.title,
        published: doc.publishedAt,
        text: (doc.text ?? "").slice(0, 1_800),
      })),
    }),
  );
  if (!said || !Array.isArray(said.json?.documents)) {
    log("chunk returned no usable JSON");
    return null;
  }
  const rows = new Map();
  for (const row of said.json.documents) {
    if (row && typeof row.id === "string") rows.set(row.id, row);
  }
  return { rows, model: said.model };
}

async function classifyOne(event, doc) {
  const said = await classifyChunk(event, [doc]);
  const row = said?.rows.get(doc.id);
  return row ? { row, model: said.model } : null;
}

async function summarise(event, docs) {
  const said = await callModel(
    READ_SYSTEM,
    JSON.stringify({
      event,
      documents: docs.slice(0, 24).map((doc) => ({
        title: doc.headline || doc.title,
        impact: doc.impact,
        team: doc.teamLabel,
        significance: doc.significance,
        detail: (doc.detail ?? "").slice(0, 180),
      })),
    }),
    { maxTokens: 700, attempts: 2 },
  );
  if (!said || typeof said.json?.read !== "string") return null;
  const teams = Array.isArray(said.json.teams)
    ? said.json.teams
        .filter((row) => row && typeof row.team === "string")
        .slice(0, 6)
        .map((row) => ({ team: row.team, flag: row.flag, note: row.note }))
    : [];
  return { read: said.json.read.trim(), teams, model: said.model };
}

async function pdfText(doc) {
  const res = await getWithRetry(doc.url, { timeoutMs: 40_000 });
  const buffer = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text).replace(/\u0000/g, " ").slice(0, MAX_TEXT);
}

/** Tiny concurrency pool, so 60 PDFs neither serialise for ten minutes nor flood FIA. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const snapshot = JSON.parse(await fs.readFile(SNAPSHOT_FILE, "utf8"));
  const race = nextRace(snapshot);
  const cars = carsFrom(snapshot);

  const teamsById = new Map([
    ["mclaren", "McLaren"],
    ["mercedes", "Mercedes"],
    ["red_bull", "Red Bull"],
    ["ferrari", "Ferrari"],
    ["williams", "Williams"],
    ["racing_bulls", "Racing Bulls"],
    ["rb", "Racing Bulls"],
    ["aston_martin", "Aston Martin"],
    ["haas", "Haas"],
    ["audi", "Audi"],
    ["sauber", "Audi"],
    ["alpine", "Alpine"],
    ["cadillac", "Cadillac"],
  ]);

  const indexHtml = await (await get(`${FIA}/documents/decision-documents`)).text();
  const options = parseEventOptions(indexHtml);
  const event = process.env.FIA_EVENT
    ? { name: process.env.FIA_EVENT, slug: process.env.FIA_EVENT }
    : pickEvent(race, options);
  log(`race ${race.round} ${race.raceName} -> FIA event "${event.name}"`);

  const eventUrl = `${FIA}/documents/decision-documents/event/${encodeURIComponent(event.slug)}`;
  const eventHtml = await (await get(eventUrl)).text();
  const listed = parseDocuments(eventHtml);
  log(`${listed.length} document(s) listed`);

  let previous = { documents: [] };
  try {
    previous = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    log("no existing data file, starting fresh");
  }
  const known = new Map((previous.documents ?? []).map((doc) => [doc.id, doc]));
  // Earlier rounds stay on the page; only this event is re-read each run.
  const archived = (previous.documents ?? []).filter(
    (doc) => doc.eventName && doc.eventName !== event.name && doc.id,
  );

  const documents = [];
  const pending = [];
  for (const doc of listed) {
    const eventName = event.name;
    const existing = known.get(doc.id);
    if (existing) {
      documents.push({ ...existing, ...doc, eventName });
    } else {
      pending.push({ ...doc, eventName });
    }
  }

  // Race-altering paperwork first, so the download budget in rules mode
  // favours what people actually open.
  const weight = (doc) =>
    /infringement|penalt|power unit|upgrade|decision|summons|collision|disqualif/i.test(doc.title)
      ? 0
      : 1;
  pending.sort((a, b) => weight(a) - weight(b) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  // Anything without a model reading gets (re)read: brand-new documents plus
  // every earlier one saved by rule. Once the key exists nothing stays on rules.
  const targets = [];
  const seen = new Set();
  for (const doc of [...pending, ...documents, ...archived]) {
    if (doc.source === "ai" || !doc.url || seen.has(doc.id)) continue;
    seen.add(doc.id);
    targets.push(doc);
  }

  const keyed = aiKey().length > 0;
  const classified = new Map();
  const textById = new Map();
  let aiModel = null;

  if (keyed && targets.length > 0) {
    log(`${targets.length} document(s) need a model reading`);
    let textFailures = 0;
    // Two at a time: enough to be quick, gentle enough that the FIA does not
    // start answering 429 halfway through the weekend's paperwork.
    const texts = await mapLimit(targets, 2, async (doc) => {
      try {
        return await pdfText(doc);
      } catch (error) {
        textFailures += 1;
        log(`pdf ${doc.id} failed: ${error.message}`);
        return "";
      }
    });
    targets.forEach((doc, index) => textById.set(doc.id, texts[index]));
    if (textFailures > 0) {
      log(`warning: ${textFailures} PDF(s) could not be downloaded; classified from title only`);
    }

    const chunks = chunkDocs(targets.map((doc) => ({ ...doc, text: textById.get(doc.id) ?? "" })));
    log(`classifying in ${chunks.length} chunk(s)`);
    for (const [index, chunk] of chunks.entries()) {
      const said = await classifyChunk(event, chunk);
      if (!said) {
        throw new Error(
          `model failed on chunk ${index + 1}/${chunks.length}; refusing to save a busy weekend as rule readings`,
        );
      }
      aiModel = said.model;
      for (const [id, row] of said.rows) classified.set(id, row);
      log(`chunk ${index + 1}/${chunks.length}: ${said.rows.size}/${chunk.length} document(s)`);
    }

    // A model that quietly drops an id is the other way this gets unreliable:
    // retry every missed document on its own before giving up.
    for (const doc of targets.filter((doc) => !classified.has(doc.id))) {
      const said = await classifyOne(event, { ...doc, text: textById.get(doc.id) ?? "" });
      if (said) {
        aiModel = said.model;
        classified.set(doc.id, said.row);
      }
    }
    const missing = targets.filter((doc) => !classified.has(doc.id));
    if (missing.length > 0) {
      throw new Error(
        `model left ${missing.length} document(s) unclassified (${missing.map((doc) => doc.id).join(", ")}); refusing to save rule readings`,
      );
    }
  } else if (!keyed) {
    // Rules mode: no key configured. Download within the polite budget.
    log(`${pending.length} new document(s) to read`);
    const budget = pending.slice(0, MAX_NEW_PDFS);
    const texts = await mapLimit(budget, 3, async (doc) => {
      try {
        return await pdfText(doc);
      } catch (error) {
        log(`pdf ${doc.id} failed: ${error.message}`);
        return "";
      }
    });
    budget.forEach((doc, index) => textById.set(doc.id, texts[index]));
  }

  const withAi = (doc, row) => {
    const fallback = rulesDoc(doc, textById.get(doc.id) ?? "", cars, teamsById);
    const teamId = teamIdFrom(row.team, teamsById) ?? fallback.team;
    return {
      impact: row.impact ?? fallback.impact,
      team: teamId,
      teamLabel: row.team ?? fallback.teamLabel,
      drivers: Array.isArray(row.drivers) ? row.drivers.slice(0, 3) : fallback.drivers,
      headline: row.headline || fallback.headline,
      detail: row.detail || fallback.detail,
      significance: row.significance ?? fallback.significance,
      source: "ai",
    };
  };

  for (const doc of pending) {
    const row = classified.get(doc.id);
    documents.push({
      ...doc,
      ...(row ? withAi(doc, row) : rulesDoc(doc, textById.get(doc.id) ?? "", cars, teamsById)),
    });
  }

  // Existing documents keep their place; any that only had a rule reading are
  // upgraded in place now that the model has seen them.
  const upgrade = (list) =>
    list.map((doc) => {
      const row = classified.get(doc.id);
      return row ? { ...doc, ...withAi(doc, row) } : doc;
    });
  const current = upgrade(documents);
  const older = upgrade(archived);

  // Keep this event's papers plus whatever earlier rounds are already stored.
  const kept = [...current, ...older]
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, MAX_KEPT_DOCS);

  const top = kept[0]?.publishedAt ?? null;
  const currentDocs = kept.filter((doc) => doc.eventName === event.name);
  const notable = currentDocs.filter((doc) => doc.significance !== "low").length;
  const fallbackRead =
    currentDocs.length === 0
      ? null
      : `The FIA has published ${currentDocs.length} document${currentDocs.length === 1 ? "" : "s"} for the ${event.name} weekend so far. ${notable} ${notable === 1 ? "looks" : "look"} race-relevant — the rest is scrutineering and paperwork.`;

  // The read describes the weekend's paperwork, so it is regenerated whenever
  // there was something new to read; otherwise the previous one is kept.
  let read = previous.read ?? null;
  let readSource = previous.readSource ?? null;
  let teams = Array.isArray(previous.teams) ? previous.teams : [];
  if (keyed && targets.length > 0 && currentDocs.length > 0) {
    const summary = await summarise({ name: event.name, round: race.round }, currentDocs);
    if (summary) {
      read = summary.read;
      teams = summary.teams;
      readSource = "ai";
      aiModel = summary.model ?? aiModel;
    } else {
      log("warning: the summary call failed; keeping the previous paddock read");
      if (!read) readSource = null;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    event: {
      name: event.name,
      round: Number(race.round),
      raceName: race.raceName,
      circuitId: race.Circuit.circuitId,
      date: race.date,
    },
    sourceUrl: eventUrl,
    latestPublishedAt: top,
    model: aiModel ?? previous.model ?? null,
    read: read ?? fallbackRead,
    readSource: readSource ?? (fallbackRead ? "rules" : null),
    teams,
    documents: kept.map((doc) => {
      const { text, rawTitle, ...rest } = doc;
      return rest;
    }),
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  log(`wrote ${payload.documents.length} document(s) to ${path.relative(ROOT, DATA_FILE)}`);
  const counts = payload.documents.reduce((acc, doc) => {
    acc[doc.impact] = (acc[doc.impact] ?? 0) + 1;
    return acc;
  }, {});
  log("impacts:", JSON.stringify(counts));
}

main().catch((error) => {
  console.error("[fia] failed:", error);
  process.exit(1);
});
