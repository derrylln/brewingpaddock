"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { timeAgo } from "@/lib/format";
import type { NewsItem, NewsPayload } from "@/lib/news";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z]+/g, "-");
}

function Thumb({ item, large = false }: { item: NewsItem; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`news-thumb cat-${slug(item.category)}${large ? " is-large" : ""}`}>
      {item.image && !broken ? (
        <img
          src={item.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="thumb-fallback mono">{item.source.slice(0, 2).toUpperCase()}</span>
      )}
      <span className="thumb-tag mono">{item.category}</span>
    </div>
  );
}

function Card({ item }: { item: NewsItem }) {
  return (
    <article className="news-card">
      <a className="news-card-link" href={item.link} target="_blank" rel="noopener noreferrer">
        <Thumb item={item} />
        <div className="news-body">
          <div className="news-meta mono">
            <span className="news-source">{item.source}</span>
            <span className="dot">·</span>
            <span>{timeAgo(item.publishedAt)}</span>
          </div>
          <h3 className="news-title">{item.title}</h3>
          {item.excerpt ? <p className="news-excerpt">{item.excerpt}</p> : null}
          <span className="news-cta mono">Read on {item.source} ↗</span>
        </div>
      </a>
    </article>
  );
}

function Row({ item }: { item: NewsItem }) {
  return (
    <a className="news-row" href={item.link} target="_blank" rel="noopener noreferrer">
      <div className="news-row-main">
        <div className="news-meta mono">
          <span className="news-source">{item.source}</span>
          <span className="dot">·</span>
          <span>{timeAgo(item.publishedAt)}</span>
        </div>
        <h3 className="news-row-title">{item.title}</h3>
      </div>
      <span className={`cat-mark cat-${slug(item.category)} mono`}>{item.category}</span>
    </a>
  );
}

export default function NewsFeed({ variant = "home" }: { variant?: "home" | "full" }) {
  const [payload, setPayload] = useState<NewsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/news")
      .then((res) => {
        if (!res.ok) throw new Error("The news wires are not answering right now.");
        return res.json() as Promise<NewsPayload>;
      })
      .then(setPayload)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = payload?.items ?? [];
  const categories = useMemo(
    () => ["all", ...Array.from(new Set(items.map((item) => item.category)))],
    [items],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (source !== "all" && item.sourceKey !== source) return false;
      if (category !== "all" && item.category !== category) return false;
      if (needle && !`${item.title} ${item.excerpt} ${item.source}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [items, source, category, query]);

  if (loading) {
    return (
      <div className="news-skeleton-grid">
        {Array.from({ length: variant === "home" ? 4 : 6 }, (_, i) => (
          <div className="news-skeleton" key={i}>
            <div className="sk-thumb" />
            <div className="sk-line w70" />
            <div className="sk-line w90" />
            <div className="sk-line w50" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel empty-state">
        <p className="mono kicker-red">FEED OFFLINE</p>
        <h3>The wires are quiet.</h3>
        <p>{error}</p>
        <button type="button" className="btn btn-ghost" onClick={load}>
          Retry the feed
        </button>
      </div>
    );
  }

  const [feature, ...rest] = filtered;

  if (variant === "home") {
    return (
      <div className="news-home">
        {feature ? (
          <article className="news-feature">
            <a href={feature.link} target="_blank" rel="noopener noreferrer">
              <Thumb item={feature} large />
              <div className="news-body">
                <div className="news-meta mono">
                  <span className="news-source">{feature.source}</span>
                  <span className="dot">·</span>
                  <span>{timeAgo(feature.publishedAt)}</span>
                  <span className="dot">·</span>
                  <span>{feature.category}</span>
                </div>
                <h3 className="news-feature-title">{feature.title}</h3>
                {feature.excerpt ? <p className="news-excerpt">{feature.excerpt}</p> : null}
                <span className="news-cta mono">Read on {feature.source} ↗</span>
              </div>
            </a>
          </article>
        ) : null}
        <div className="news-stack">
          {rest.slice(0, 6).map((item) => (
            <Row item={item} key={item.id} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="news-full">
      <div className="news-controls">
        <div className="chip-row">
          <button
            type="button"
            className={`chip${source === "all" ? " is-on" : ""}`}
            onClick={() => setSource("all")}
          >
            All sources
          </button>
          {payload?.sources.map((entry) => (
            <button
              type="button"
              key={entry.key}
              className={`chip${source === entry.key ? " is-on" : ""}${entry.ok ? "" : " is-dead"}`}
              onClick={() => setSource(entry.key)}
              disabled={!entry.ok}
              title={entry.ok ? `${entry.count} stories` : "feed unavailable"}
            >
              {entry.name}
            </button>
          ))}
        </div>
        <div className="news-controls-row">
          <div className="chip-row">
            {categories.map((entry) => (
              <button
                type="button"
                key={entry}
                className={`chip chip-ghost${category === entry ? " is-on" : ""}`}
                onClick={() => setCategory(entry)}
              >
                {entry === "all" ? "Everything" : entry}
              </button>
            ))}
          </div>
          <input
            className="input search-input"
            type="search"
            placeholder="Search the wire…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search news"
          />
        </div>
      </div>

      <div className="news-count mono">
        {filtered.length} stories · {payload?.sources.filter((s) => s.ok).length ?? 0} sources live ·
        refreshed {payload ? timeAgo(payload.fetchedAt) : "—"}
      </div>

      <div className="news-grid">
        {filtered.map((item) => (
          <Card item={item} key={item.id} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="panel empty-state">
          <h3>Nothing matches that filter.</h3>
          <p>Try a different source, or clear the search.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSource("all");
              setCategory("all");
              setQuery("");
            }}
          >
            Reset filters
          </button>
        </div>
      ) : null}
    </div>
  );
}
