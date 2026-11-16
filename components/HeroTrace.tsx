import { CACHED_TELEMETRY } from "@/lib/telemetry";

function buildPath(values: number[], max: number, width: number, height: number): string {
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / max) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function HeroTrace() {
  const lap = CACHED_TELEMETRY.drivers[0];
  const speed = lap.points.map((p) => p.v);
  const throttle = lap.points.map((p) => p.th);
  const maxSpeed = Math.max(...speed, 1);
  const width = 1200;
  const height = 420;
  const path = buildPath(speed, maxSpeed, width, height);
  const area = `${path} L${width},${height} L0,${height} Z`;
  const throttlePath = buildPath(throttle, 100, width, height * 0.55);

  return (
    <div className="hero-trace" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="traceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E10600" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#E10600" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="traceStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#E10600" stopOpacity="0.2" />
            <stop offset="55%" stopColor="#FF2A20" />
            <stop offset="100%" stopColor="#FF8A80" />
          </linearGradient>
        </defs>
        {Array.from({ length: 9 }, (_, i) => (
          <line
            key={i}
            x1={(i / 8) * width}
            y1={0}
            x2={(i / 8) * width}
            y2={height}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        ))}
        <path d={throttlePath} fill="none" stroke="rgba(244,243,239,0.16)" strokeWidth="1.5" />
        <path d={area} fill="url(#traceFill)" />
        <path d={path} fill="none" stroke="url(#traceStroke)" strokeWidth="2.5" />
        <circle cx={width} cy={height - (speed[speed.length - 1] / maxSpeed) * height} r="4" fill="#FF2A20" />
      </svg>
      <div className="hero-trace-caption mono">
        {CACHED_TELEMETRY.session.year} · {CACHED_TELEMETRY.session.circuit} · {lap.code} fastest race lap ·{" "}
        {lap.lapTime.toFixed(3)}s
      </div>
    </div>
  );
}
