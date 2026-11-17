import type { Metadata } from "next";
import "./globals.css";
import Grain from "@/components/Grain";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: {
    default: "Brewing Paddock — F1, brewed strong",
    template: "%s · Brewing Paddock",
  },
  description:
    "Live F1 news aggregation, telemetry comparison, an AI race strategist, a seeded race predictor and a grounded paddock chatbot. Every lap, every rumour, one desk.",
  applicationName: "Brewing Paddock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
        {/* Applies the saved theme before first paint, so light mode never flashes dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              // Dark is the desk's default; a saved choice always wins.
              "(function(){try{var t=localStorage.getItem('bp-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Grain />
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
