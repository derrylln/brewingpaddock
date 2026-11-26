"use client";

import { useMemo, useState } from "react";
import {
  IMPACT_LABEL,
  type FiaDocument,
  type ReportImpact,
} from "@/lib/fia-reports";
import { teamColour } from "@/lib/teams";

type Filter = "all" | "penalties" | "performance" | "stewards" | "results" | "paperwork";

const FILTERS: Array<{ id: Filter; label: string; impacts: ReportImpact[] | null }> = [
  { id: "all", label: "Everything", impacts: null },
  { id: "penalties", label: "Penalties", impacts: ["penalty"] },
  { id: "performance", label: "Upgrades & PU", impacts: ["upgrade", "power-unit"] },
  { id: "stewards", label: "Stewards", impacts: ["decision", "scrutineering"] },
  { id: "results", label: "Results", impacts: ["result", "entry"] },
  { id: "paperwork", label: "Paperwork", impacts: ["briefing", "other"] },
];

const SIGNIFICANCE_LABEL = { high: "race-altering", medium: "worth knowing", low: "routine" } as const;

function matches(doc: FiaDocument, filter: Filter): boolean {
  const impacts = FILTERS.find((row) => row.id === filter)?.impacts;
  return !impacts || impacts.includes(doc.impact);
}

/**
 * The paper trail, filterable without a round trip. Grouped by event so the
 * current weekend's documents sit above the previous round's archive.
 */
export default function PapersBoard({
  documents,
  currentEvent,
}: {
  documents: FiaDocument[];
  currentEvent: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const events = useMemo(() => {
    const seen: string[] = [];
    for (const doc of documents) {
      const name = doc.eventName ?? "FIA";
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  }, [documents]);

  const counts = useMemo(() => {
    const result = {} as Record<Filter, number>;
    for (const row of FILTERS) {
      result[row.id] = documents.filter((doc) => matches(doc, row.id)).length;
    }
    return result;
  }, [documents]);

  return (
    <section className="papers-board">
      <div className="papers-filter-row" role="tablist" aria-label="Filter documents">
        {FILTERS.map((row) => (
          <button
            key={row.id}
            type="button"
            role="tab"
            aria-selected={filter === row.id}
            className={`chip${filter === row.id ? " is-on" : ""}`}
            onClick={() => setFilter(row.id)}
          >
            {row.label}
            <span className="papers-chip-count">{counts[row.id]}</span>
          </button>
        ))}
      </div>

      {events.map((event) => {
        const list = documents.filter((doc) => (doc.eventName ?? "FIA") === event && matches(doc, filter));
        if (list.length === 0) return null;
        const current = event === currentEvent;
        return (
          <div className="papers-group" key={event}>
            <div className="papers-group-head">
              <h3>{event}</h3>
              <span className="mono">{current ? "this weekend" : "previous round"}</span>
            </div>
            <div className="papers-grid">
              {list.map((doc) => {
                const colour = doc.team ? teamColour(doc.team) : "var(--faint)";
                return (
                  <article className={`paper-card is-${doc.significance}`} key={doc.id}>
                    <span className="paper-rail" style={{ background: colour }} aria-hidden="true" />
                    <div className="paper-body">
                      <div className="paper-meta mono">
                        <span className="paper-number">{doc.doc ? `Doc ${doc.doc}` : "FIA"}</span>
                        <span className={`impact-tag is-${doc.impact}`}>
                          {IMPACT_LABEL[doc.impact]}
                        </span>
                        <span>{doc.publishedLabel}</span>
                        {doc.significance === "high" ? (
                          <span className="paper-flag">race-altering</span>
                        ) : null}
                      </div>
                      <h4>{doc.headline || doc.title}</h4>
                      <p>{doc.detail}</p>
                      <div className="paper-foot mono">
                        <span className="paper-teams">
                          {doc.teamLabel ? (
                            <span className="paper-team" style={{ color: colour }}>
                              <i style={{ background: colour }} aria-hidden="true" />
                              {doc.teamLabel}
                            </span>
                          ) : null}
                          {doc.drivers.map((code) => (
                            <span className="paper-driver" key={code}>
                              {code}
                            </span>
                          ))}
                        </span>
                        <a href={doc.url} target="_blank" rel="noreferrer noopener">
                          Official PDF ↗
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}

      {documents.filter((doc) => matches(doc, filter)).length === 0 ? (
        <p className="papers-empty">
          No documents in this category yet. The FIA publishes through the weekend, and the desk
          picks them up on its next daily run.
        </p>
      ) : null}

      <p className="papers-note mono">
        {documents.length} documents · {SIGNIFICANCE_LABEL.high} items are flagged · every row links
        to the FIA&apos;s own PDF
      </p>
    </section>
  );
}
