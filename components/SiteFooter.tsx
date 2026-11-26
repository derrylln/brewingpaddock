import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <p className="serif footer-script">Brewed by Brewing Paddock</p>
          <p className="footer-copy">
            A pit-wall desk for people who read the timing screens for fun. Live results and
            standings, telemetry, strategy calls, a simulated grid and the FIA&apos;s paperwork
            decoded.
          </p>
          <p className="footer-fine">
            Independent fan project. Not affiliated with Formula 1, the FIA or any team.
          </p>
        </div>

        <div className="footer-col">
          <h4>The Desk</h4>
          <Link href="/news">Live wire</Link>
          <Link href="/telemetry">Telemetry</Link>
          <Link href="/strategy">Race strategist</Link>
          <Link href="/predict">Predictor</Link>
          <Link href="/papers">The papers</Link>
        </div>

        <div className="footer-col">
          <h4>Data</h4>
          <span>Jolpica F1 API</span>
          <span>OpenF1 telemetry</span>
          <span>Public team RSS feeds</span>
          <span>FIA regulations digest</span>
          <span>Refreshed every 4–5 minutes</span>
        </div>
      </div>

      <div className="shell footer-bottom">
        <span className="mono">© {new Date().getFullYear()} Brewing Paddock</span>
        <span className="mono footer-tag">Every lap. Every rumour. One paddock.</span>
      </div>
    </footer>
  );
}
