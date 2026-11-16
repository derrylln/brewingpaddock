import Link from "next/link";

type Module = {
  index: string;
  href: string;
  title: string;
  description: string;
  meta: string;
  wide?: boolean;
};

export default function ModulesGrid({ latestRound }: { latestRound?: number }) {
  const modules: Module[] = [
    {
      index: "01",
      href: "/strategy",
      title: "Race Strategist",
      description:
        "Feed it a safety car, a dying hard tyre or a drying track. The stint model prices every pit window and hands you the call, with the assumptions laid out.",
      meta: "Interactive · stint model",
      wide: true,
    },
    {
      index: "02",
      href: "/telemetry",
      title: "Telemetry Compare",
      description:
        "Two fastest laps, distance-aligned. Speed, throttle, brake and the delta trace, straight out of OpenF1.",
      meta: "OpenF1 · live session",
    },
    {
      index: "03",
      href: "/ask",
      title: "Ask Paddock",
      description:
        "A chatbot that only answers what the data can back up — standings, archives, sector times, rules.",
      meta: "Retrieval · cited",
    },
    {
      index: "04",
      href: "/predict",
      title: "Race Predictor",
      description:
        "Qualifying pace, form, championship weight and reliability, run through 4,000 seeded simulations.",
      meta: "Monte Carlo · seeded",
    },
    {
      index: "05",
      href: latestRound ? `/race/${latestRound}` : "/news",
      title: "Auto Debrief",
      description:
        "Every classified finish, pit stop and qualifying lap turned into a punchy race report, generated in seconds.",
      meta: "Pipeline · post-race",
    },
  ];

  return (
    <div className="modules">
      {modules.map((module) => (
        <Link
          key={module.index}
          href={module.href}
          className={`module-card${module.wide ? " is-wide" : ""}`}
        >
          <span className="module-index mono">{module.index}</span>
          <h3 className="module-title">{module.title}</h3>
          <p className="module-desc">{module.description}</p>
          <span className="module-meta mono">{module.meta}</span>
          <span className="module-arrow" aria-hidden="true">
            ↗
          </span>
        </Link>
      ))}
    </div>
  );
}
