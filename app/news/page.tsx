import type { Metadata } from "next";
import NewsFeed from "@/components/NewsFeed";

export const metadata: Metadata = {
  title: "Live wire",
  description:
    "Every F1 headline from seven desks — The Race, Motorsport.com, Autosport, RaceFans, Motorsport Week, RACER and ESPN — deduplicated and refreshed every four minutes.",
};

export default function NewsPage() {
  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <p className="mono kicker-red">01 / The wire</p>
          <h1 className="page-title">
            Every headline,
            <br />
            <em>one pour.</em>
          </h1>
          <p className="page-deck">
            Seven F1 desks, polled server-side every four minutes, deduplicated and tagged. We do not
            rewrite the story — we point you at the original and tell you what kind of story it is.
          </p>
        </header>
        <NewsFeed variant="full" />
      </div>
    </div>
  );
}
