"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Desk" },
  { href: "/news", label: "Wire" },
  { href: "/telemetry", label: "Telemetry" },
  { href: "/strategy", label: "Strategist" },
  { href: "/predict", label: "Predictor" },
  { href: "/papers", label: "Papers" },
  { href: "/ask", label: "Ask" },
];

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="Brewing Paddock home">
          <BrandMark className="brand-mark" />
          <span className="brand-word">
            <em>Brewing</em> Paddock
          </span>
        </Link>

        <nav className="nav" aria-label="Sections">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${active ? " is-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-right">
          <ThemeToggle />
          <span className="header-season">2026</span>
          <span className="live-pill">
            <span className="live-dot" aria-hidden="true" />
            Live data
          </span>
        </div>
      </div>
    </header>
  );
}
