import type { Metadata } from "next";
import PapersBoard from "@/components/PapersBoard";
import {
  IMPACT_LABEL,
  REPORTS,
  eventDocuments,
  readStaleness,
  reportDate,
  watchDocuments,
} from "@/lib/fia-reports";

export const metadata: Metadata = {
  title: "The papers",
  description:
    "Every document the FIA publishes for the next grand prix — upgrades, power-unit changes, penalties and stewards' decisions — summarised in plain English, with a link to the official PDF.",
};

export default function PapersPage() {
  const race = REPORTS.event;
  const current = eventDocuments();
  const watch = watchDocuments(4);
  const latest = current[0] ?? REPORTS.documents[0] ?? null;
  const ai = REPORTS.readSource === "ai";
  const staleness = readStaleness();

  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <p className="mono kicker-red">06 / The papers</p>
          <h1 className="page-title">
            The paperwork,
            <br />
            <em>decoded.</em>
          </h1>
          <p className="page-deck">
            The FIA drops dozens of PDFs on a race weekend — power-unit declarations, scrutineering
            reports, summons and stewards&apos; decisions. Most people never open one. This desk
            reads them once a day, pulls out the upgrades and the penalties that actually matter, and
            links every summary back to the official document.
          </p>
        </header>

        <div className="papers-facts">
          <div className="papers-fact">
            <span className="mono">Next race</span>
            <strong>{race?.raceName ?? "—"}</strong>
            <em>{race ? reportDate(`${race.date}T12:00:00Z`) : "calendar pending"}</em>
          </div>
          <div className="papers-fact">
            <span className="mono">Documents</span>
            <strong>{current.length}</strong>
            <em>published for this weekend</em>
          </div>
          <div className="papers-fact">
            <span className="mono">Latest paper</span>
            <strong>{latest?.publishedLabel ?? "—"}</strong>
            <em>{latest ? `${latest.eventName ?? "FIA"} · ${latest.title}` : "none yet"}</em>
          </div>
          <div className="papers-fact">
            <span className="mono">Read by</span>
            <strong>{ai ? "Model" : "Rules"}</strong>
            <em>{ai ? REPORTS.model ?? "daily model run" : "daily desk run, no model call"}</em>
          </div>
        </div>

        <section className="panel papers-read">
          <div className="panel-head">
            <h3>The paddock read</h3>
            <span className="mono">
              {ai ? `MODEL · ${REPORTS.model}` : "RULE READ · ONE PASS, NO MODEL"}
            </span>
          </div>
          <p className="papers-read-text">
            {REPORTS.read ??
              "No papers for the next race yet. The FIA usually opens the event documents a few days before first practice."}
          </p>
          {staleness.stale ? (
            <p className="papers-read-stale mono">
              {staleness.newer} document{staleness.newer === 1 ? "" : "s"} published since this
              read — the next model pass rewrites it. The list below is current.
            </p>
          ) : null}
          {watch.length > 0 ? (
            <ul className="papers-watch">
              {watch.map((doc) => (
                <li key={doc.id}>
                  <a href={doc.url} target="_blank" rel="noreferrer noopener">
                    <span className={`impact-tag is-${doc.impact}`}>{IMPACT_LABEL[doc.impact]}</span>
                    <span className="papers-watch-detail">
                      <strong>{doc.title}</strong>
                      {doc.teamLabel ? ` · ${doc.teamLabel}` : ""} — {doc.detail}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="papers-source mono">
            <a href={REPORTS.sourceUrl} target="_blank" rel="noreferrer noopener">
              All documents on fia.com ↗
            </a>
            <span>updated {reportDate(REPORTS.generatedAt)}</span>
          </p>
        </section>

        <PapersBoard documents={REPORTS.documents} currentEvent={race?.name ?? ""} />

        <p className="papers-disclaimer">
          Summaries are ours; the documents are the FIA&apos;s, and every row links to the original
          PDF. The papers are context for the race preview only — the strategist forecast and the
          predictor do not read them into their numbers yet.
        </p>
      </div>
    </div>
  );
}
