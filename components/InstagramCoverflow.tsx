"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IgPost } from "@/lib/instagram";

type Props = { posts: IgPost[]; handle: string; url: string };

/**
 * The feed as a cover flow: one post square to the camera, the neighbours
 * rotated away behind it on each side. Click a side card, use the arrows, the
 * keyboard, or swipe on touch.
 */
export default function InstagramCoverflow({ posts, handle, url }: Props) {
  const [active, setActive] = useState(0);
  const count = posts.length;
  const startX = useRef<number | null>(null);

  const go = useCallback(
    (dir: number) => setActive((i) => (i + dir + count) % count),
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!count) return null;
  const current = posts[active];

  return (
    <section className="ig" aria-label={`Latest from @${handle}`}>
      <div className="shell ig-head">
        <div>
          <p className="mono kicker-red">The feed · @{handle}</p>
          <h2 className="ig-title">Straight from the paddock</h2>
        </div>
        <a className="text-link mono ig-follow" href={url} target="_blank" rel="noopener noreferrer">
          Follow on Instagram ↗
        </a>
      </div>

      <div className="ig-stage">
        <div
          className="ig-track"
          onPointerDown={(e) => {
            startX.current = e.clientX;
          }}
          onPointerUp={(e) => {
            if (startX.current === null) return;
            const dx = e.clientX - startX.current;
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
            startX.current = null;
          }}
        >
          {posts.map((post, i) => {
            let pos = i - active;
            if (pos > count / 2) pos -= count;
            if (pos < -count / 2) pos += count;
            const depth = Math.abs(pos);
            const hidden = depth > 2;

            return (
              <button
                key={post.id}
                type="button"
                className={`ig-card${pos === 0 ? " is-active" : ""}`}
                aria-label={pos === 0 ? `Open post: ${post.caption}` : `Bring post ${i + 1} to the front`}
                aria-hidden={hidden}
                tabIndex={hidden ? -1 : 0}
                onClick={() => (pos === 0 ? undefined : setActive(i))}
                style={{
                  // --pos drives the horizontal swing in CSS so a media query can
                  // tighten it on phones without recomputing in JS.
                  ["--pos" as string]: pos,
                  transform: `translate(-50%, -50%) translateX(calc(var(--pos) * var(--swing))) translateZ(${-depth * 110}px) rotateY(${pos * -28}deg) scale(${1 - Math.min(depth, 3) * 0.085})`,
                  zIndex: 20 - depth,
                  opacity: hidden ? 0 : 1,
                  pointerEvents: hidden ? "none" : "auto",
                }}
              >
                <span className="ig-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={post.image} alt="" loading={depth < 2 ? "eager" : "lazy"} decoding="async" />
                  <span className="ig-badge mono">{post.kind === "reel" ? "Reel" : "Post"}</span>
                </span>
              </button>
            );
          })}
        </div>

        <button type="button" className="ig-arrow is-prev" onClick={() => go(-1)} aria-label="Previous post">
          <span aria-hidden="true">‹</span>
        </button>
        <button type="button" className="ig-arrow is-next" onClick={() => go(1)} aria-label="Next post">
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="shell ig-foot">
        <p className="ig-caption">{current.caption}</p>
        <div className="ig-foot-right">
          <div className="ig-dots" aria-hidden="true">
            {posts.map((p, i) => (
              <span key={p.id} className={`ig-dot${i === active ? " is-on" : ""}`} />
            ))}
          </div>
          <a
            className="btn btn-ghost ig-open"
            href={current.permalink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on Instagram ↗
          </a>
        </div>
      </div>
    </section>
  );
}
