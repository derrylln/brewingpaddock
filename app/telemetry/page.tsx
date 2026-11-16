import type { Metadata } from "next";
import TelemetryDashboard from "@/components/TelemetryDashboard";

export const metadata: Metadata = {
  title: "Telemetry compare",
  description:
    "Distance-aligned speed, throttle, brake and delta traces for the two fastest laps of the latest session, pulled live from OpenF1.",
};

export default function TelemetryPage() {
  return (
    <div className="page">
      <div className="shell">
        <header className="page-head">
          <p className="mono kicker-red">02 / Telemetry</p>
          <h1 className="page-title">
            Two laps,
            <br />
            <em>one line.</em>
          </h1>
          <p className="page-deck">
            The two fastest race laps of the latest session, distance-aligned corner by corner.
            Speed, throttle, brake and the running delta — the same view a performance engineer
            stares at on a Sunday night.
          </p>
        </header>
        <TelemetryDashboard />
      </div>
    </div>
  );
}
