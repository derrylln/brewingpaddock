import type { Metadata } from "next";
import StrategyLab from "@/components/StrategyLab";

export const metadata: Metadata = {
  title: "Race strategist",
  description:
    "Set the scenario — circuit, lap, tyre age, gaps, temperature, weather or a safety car — and the stint model prices every pit window for you.",
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
            Give the model a scenario — a safety car, a dying hard tyre, a drying track — and it
            simulates every sensible pit window to the flag. You get the recommended plan, the
            alternatives and the assumptions behind them.
          </p>
        </header>
        <StrategyLab />
      </div>
    </div>
  );
}
