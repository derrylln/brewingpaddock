import type { Metadata } from "next";
import AskPaddock from "@/components/AskPaddock";

export const metadata: Metadata = {
  title: "Ask Paddock",
  description:
    "A grounded F1 chatbot: championship order, race archives, sector times and the rulebook, with the source cited on every answer.",
};

export default function AskPage() {
  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <p className="mono kicker-red">05 / Ask Paddock</p>
          <h1 className="page-title">
            Granular
            <br />
            <em>by design.</em>
          </h1>
          <p className="page-deck">
            Ask the desk a specific question. It checks the live championship, the race archive, the
            telemetry fixture and the regulations digest before it answers — and tells you which one
            it used.
          </p>
        </header>
        <AskPaddock />
      </div>
    </div>
  );
}
