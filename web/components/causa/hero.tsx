"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "@/components/ui/icons";
import { motion, useReducedMotion } from "motion/react";
import { MountainParallax, type HeroMarker } from "./mountain-parallax";
import { useNews } from "@/lib/hooks/useNews";
import { usePulse } from "@/lib/hooks/useTerminal";
import { useNow } from "@/lib/hooks/useNow";
import { timeAgo } from "@/lib/format";

/**
 * SECTION 01 — HERO / THE CAUSE (03_FRONTEND_SPEC §5).
 *
 * The range runs full-bleed behind the whole section and separates on scroll;
 * the statement sits left on paper, held off the peaks by a gradient scrim, and
 * the live layer (clock, catalyst, tickers) is stacked right — "visible but
 * subordinate", per the spec.
 *
 * The catalyst card is a real story off the wire. If the wire is empty the card
 * is not rendered rather than showing invented copy (02_ASSET_GUIDE §17).
 */
export function CausaHero() {
  const reduce = useReducedMotion();
  const { data } = useNews({ limit: 4 });
  const pulse = usePulse();
  const now = useNow(1000);

  const lead = data?.data?.items?.[0] ?? null;
  const quotes = pulse.data?.stocks.quotes ?? [];
  const strip = quotes.filter((q) => q.change24h !== null).slice(0, 5);

  const utc = new Date(now).toISOString().slice(11, 19);

  // Cause Markers on the range carry the four freshest stories off the wire.
  // IDs use the pack's C/ notation over a stable hash of the story id — real
  // stories, real tickers, nothing invented.
  const causaId = (id: string) =>
    `C/${(Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 90000) + 10000}`;
  const markers: HeroMarker[] = (data?.data?.items ?? []).slice(0, 4).map((s) => ({
    id: causaId(s.id),
    label: s.tickers[0] ?? s.category,
    title: s.title,
    source: s.source.name,
    when: timeAgo(s.publishedAt),
    url: s.url,
  }));

  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0, y: 0 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.52, delay, ease: [0.2, 0.8, 0.3, 1] as const },
        };

  return (
    <section className="causa-hero" aria-labelledby="causa-hero-title">
      <MountainParallax markers={markers} />

      <div className="causa-hero-grid">
        <div className="causa-hero-copy">
          <motion.div className="eyebrow-row" {...rise(0.02)}>
            <span className="live-pip" aria-hidden="true" />
            <span className="eyebrow">First-ever multi-stock split on StonkFun</span>
            <span className="eyebrow utc num">{utc} UTC</span>
          </motion.div>

          <motion.h1 id="causa-hero-title" {...rise(0.08)}>
            Markets move
            <br />
            for a reason.
          </motion.h1>

          <motion.p className="causa-hero-sub" {...rise(0.18)}>
            Discover the catalyst. Create the market. Trade the reaction.
          </motion.p>

          <motion.div className="causa-hero-actions" {...rise(0.26)}>
            <Link className="btn-signal" href={"/launch" as Route}>
              Create a Market
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link className="btn-quiet" href={"/vaults" as Route}>
              Explore Live Markets
            </Link>
          </motion.div>
        </div>

        {lead && (
          <motion.article
            className="catalyst-flag"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.42, ease: [0.2, 0.8, 0.3, 1] }}
          >
            <header>
              <span className="status status-breaking">Breaking</span>
              <span className="num">{timeAgo(lead.publishedAt)}</span>
            </header>
            <h2>{lead.title}</h2>
            <footer>
              <span>{lead.source.name}</span>
              {lead.tickers.length > 0 && (
                <span className="flag-tickers num">{lead.tickers.slice(0, 3).join("  ")}</span>
              )}
            </footer>
          </motion.article>
        )}
      </div>

      {strip.length > 0 && (
        <motion.dl className="causa-hero-strip" {...rise(0.34)}>
          {strip.map((q) => (
            <div key={q.symbol}>
              <dt className="num">{q.symbol}</dt>
              <dd className="num">
                ${q.priceUsd >= 1000 ? q.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : q.priceUsd.toFixed(2)}
                <em className={(q.change24h ?? 0) < 0 ? "is-neg" : "is-pos"}>
                  {(q.change24h ?? 0) >= 0 ? "+" : ""}
                  {(q.change24h ?? 0).toFixed(2)}%
                </em>
              </dd>
            </div>
          ))}
        </motion.dl>
      )}
    </section>
  );
}
