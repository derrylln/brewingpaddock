import type { Metadata } from "next";
import PredictRecordPanel from "@/components/PredictRecordPanel";
import Predictor from "@/components/Predictor";

export const metadata: Metadata = {
  title: "Race predictor",
  description:
    "A seeded Monte Carlo forecast for the next Grand Prix, built on qualifying pace, recent form, championship weight, consistency and team strength.",
};

export default function PredictPage() {
  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <p className="mono kicker-red">04 / Race predictor</p>
          <h1 className="page-title">
            The grid,
            <br />
            <em>simulated.</em>
          </h1>
          <p className="page-deck">
            Five weighted factors, four thousand seeded races, one probability table. Built from
            every classification of the season so far — and honest about the things a model cannot
            see. Below it, the record: every pre-race ranking frozen when it was made and scored
            against the classification, with older rounds replayed on the data of the time.
          </p>
        </header>
        <Predictor />
        <PredictRecordPanel />
      </div>
    </div>
  );
}
