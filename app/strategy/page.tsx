import type { Metadata } from "next";
import ForecastRecordPanel from "@/components/ForecastRecordPanel";
import StrategyForecastPanel from "@/components/StrategyForecastPanel";
import StrategyLab from "@/components/StrategyLab";

export const metadata: Metadata = {
  title: "Race strategist",
  description:
    "The most likely race plan for the next grand prix, priced across weather and safety-car scenarios, plus a stint model that prices every pit window from any lap you set.",
};

export default function StrategyPage() {
  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <p className="mono kicker-red">03 / Race strategist</p>
          <h1 className="page-title">
            The call,
            <br />
            <em>priced.</em>
          </h1>
          <p className="page-deck">
            First the forecast: every sensible plan for the next race, priced across track
            temperature and late-race safety-car windows, so you can see what the grid is most
            likely to do before a wheel turns. Below it, the record: each pre-race call frozen when it
            was made and scored against the pit log, with older rounds replayed and labelled as such.
            Then set your own scenario — a safety car, a dying hard tyre, a drying track — and price
            every pit window to the flag.
          </p>
        </header>
        <StrategyForecastPanel />
        <ForecastRecordPanel />
        <StrategyLab />
      </div>
    </div>
  );
}
