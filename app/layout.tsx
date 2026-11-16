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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,300..900;1,300..900&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap"
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
