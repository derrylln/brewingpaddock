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
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
        {/* Applies the saved theme before first paint, so light mode never flashes dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              // Light is the house look; a saved choice always wins.
              "(function(){try{var t=localStorage.getItem('bp-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'light';}catch(e){document.documentElement.dataset.theme='light';}})();",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap"
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
