import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { THEME_SCRIPT } from "@/lib/theme";
import { Manrope } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import "./multi.css";
import "./cinematic.css";
import "./linkr.css";
import "./theme-dark.generated.css";
import "./theme-dark.css";
import { Providers } from "./providers";
import { SiteNav } from "@/components/site/site-nav";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteMain } from "@/components/site/site-main";

// LINKR's typographic principle: serif = idea, sans = market, mono = system.
// Instrument Serif carries every editorial statement; Geist carries everything
// the market touches; Geist Mono is reserved for Catalyst IDs, UTC stamps and
// dense tables.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  // Needed for opengraph-image.jpg / twitter-image.jpg to resolve to absolute URLs.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3001"),
  ),
  title: { default: "LINKR — Every market starts with a reason", template: "%s · LINKR" },
  description:
    "Discover the thesis. Hold the coin. Earn the stocks. LINKR launches coins on StonkFun around an idea and pays their holders in the tokenised stocks it is about.",
  applicationName: "LINKR",
  openGraph: {
    type: "website",
    siteName: "LINKR",
    title: "LINKR — Every market starts with a reason",
    description: "Discover the thesis. Hold the coin. Earn the stocks.",
  },
  twitter: { card: "summary_large_image", site: BRAND.xHandle },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme before React hydrates, so the attribute can legitimately differ from the server's.
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <noscript>
          <style>{`.reveal,.reveal-stagger>*{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>
        <Providers>
          <div className="site-shell linkr-app">
            <a className="skip-link" href="#main">Skip to content</a>
            <SiteNav />
            <SiteMain>{children}</SiteMain>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
