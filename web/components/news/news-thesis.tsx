"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowSquareOut, Sparkle } from "@/components/ui/icons";
import { usePulse } from "@/lib/hooks/useTerminal";
import { timeAgo } from "@/lib/format";
import { PairMark } from "@/components/site/pair-mark";
import type { NewsItem } from "@/lib/news/types";
import { CategoryChip, TickerChips, useQuoteMap } from "./news-bits";

const SENTIMENT_LABEL = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" } as const;

/**
 * What a headline means for something you can actually pair to.
 *
 * The story's own words come from the wire; everything priced underneath them is read
 * live — the ticker's real 24h move, or, when the story maps to a narrative, that
 * basket's real spread. The panel's job is to end on the same question the rest of the
 * site asks: one name, or the whole idea?
 */
export function NewsThesis({
  item,
  items = [],
  onSelect,
}: {
  item: NewsItem | null;
  /** The rest of the wire, so the panel can offer the stories touching the same names. */
  items?: NewsItem[];
  onSelect?: (id: string) => void;
}) {
  const quotes = useQuoteMap();
  const { data } = usePulse();
  // Narrative ids are opaque ("ai-infra"); the pulse knows what they are called.
  const basketNames = useMemo(
    () => new Map((data?.narratives ?? []).map((n) => [n.id, n.name])),
    [data],
  );

  // Other stories pulling on the same tickers or the same basket. This is the argument
  // the panel is making, made twice: one headline rarely moves one name.
  const related = useMemo(() => {
    if (!item) return [];
    const tickers = new Set(item.tickers);
    const mine = new Set(item.narratives ?? []);
    return items
      .filter((o) => o.id !== item.id)
      .map((o) => ({
        item: o,
        shared: o.tickers.filter((t) => tickers.has(t)),
        baskets: (o.narratives ?? []).filter((n) => mine.has(n)),
      }))
      .filter((o) => o.shared.length > 0 || o.baskets.length > 0)
      // A story naming the same ticker is genuinely related; one that merely sits in the same
      // basket is a weaker link. Without this the panel just replayed the top of the list, which
      // is already on screen to its left.
      .sort((a, b) => b.shared.length - a.shared.length)
      .slice(0, 3);
  }, [item, items]);

  if (!item) {
    return (
      <aside className="news-thesis empty">
        <p>Pick a story to see what it touches.</p>
      </aside>
    );
  }

  const ticker = item.tickers.find((t) => quotes.has(t)) ?? item.tickers[0] ?? null;
  const quote = ticker ? quotes.get(ticker) : undefined;
  const narrative = (data?.narratives ?? []).find((n) => item.narratives?.includes(n.id)) ?? null;
  const body = item.insight ?? item.summary;

  return (
    <aside className="news-thesis">
      <div className="news-thesis-head">
        <span className="news-thesis-mark">
          {item.insight ? (
            <>
              <Sparkle size={13} aria-hidden="true" />
              LINKR <b>Insight</b>
            </>
          ) : (
            <CategoryChip item={item} />
          )}
        </span>
        <small>{timeAgo(item.publishedAt)}</small>
      </div>

      <h3>{item.title}</h3>
      {body && <p>{body}</p>}

      {(item.sentiment || (item.tags ?? []).length > 0) && (
        <div className="news-thesis-tags">
          {item.sentiment && <em className={`news-tag ${item.sentiment}`}>{SENTIMENT_LABEL[item.sentiment]}</em>}
          {(item.tags ?? []).slice(0, 3).map((t) => (
            <em className="news-tag" key={t}>
              {t}
            </em>
          ))}
        </div>
      )}

      {/* Every name the story touches, each carrying its own real move — the reason a
          one-ticker pairing is a guess about which member reacts. */}
      <TickerChips symbols={item.tickers} max={4} />

      {related.length > 0 && (
        <div className="news-related">
          <span>Also on the wire</span>
          {related.map(({ item: r, shared, baskets }) => (
            <button type="button" className="news-related-row" key={r.id} onClick={() => onSelect?.(r.id)}>
              <strong>{r.title}</strong>
              <small>
                {timeAgo(r.publishedAt)}
                <i aria-hidden="true">·</i>
                {shared.length > 0 ? shared.join(" ") : (basketNames.get(baskets[0]) ?? "same basket")}
              </small>
            </button>
          ))}
        </div>
      )}

      {/* Priced live. A ticker with no quote shows no number at all. */}
      {narrative ? (
        <div className="news-asset basket" style={{ ["--accent" as string]: narrative.accent }}>
          <span className="news-asset-copy">
            <strong>{narrative.name}</strong>
            <small>{narrative.size} stocks · equal weight</small>
          </span>
          <span className="news-asset-price">
            <strong>
              {narrative.basketChange24h === null
                ? "—"
                : `${narrative.basketChange24h >= 0 ? "+" : ""}${narrative.basketChange24h.toFixed(2)}%`}
            </strong>
            <small>
              {narrative.spreadPct === null ? "no live spread" : `${narrative.spreadPct.toFixed(1)}pt spread today`}
            </small>
          </span>
        </div>
      ) : quote ? (
        <div className="news-asset">
          <PairMark symbol={quote.symbol} logoUrl={quote.logoUrl} />
          <span className="news-asset-copy">
            <strong>{quote.symbol}</strong>
            <small>{quote.name}</small>
          </span>
          <span className="news-asset-price">
            <strong>${quote.priceUsd >= 1000 ? quote.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : quote.priceUsd.toFixed(2)}</strong>
            <small className={(quote.change24h ?? 0) < 0 ? "down" : "up"}>
              {quote.change24h === null
                ? "no 24h quote"
                : `${quote.change24h >= 0 ? "+" : ""}${quote.change24h.toFixed(2)}%`}
            </small>
          </span>
        </div>
      ) : null}

      <Link className="news-thesis-cta" href={"/launch" as Route}>
        {narrative
          ? `Pair a coin to ${narrative.name}`
          : ticker
            ? `Pair a coin to ${ticker}`
            : "Launch a coin"}
        <ArrowRight size={15} aria-hidden="true" />
      </Link>

      <p className="news-thesis-foot">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            Read on {item.source.name}
            <ArrowSquareOut size={12} aria-hidden="true" />
          </a>
        ) : (
          <span>{item.source.name}</span>
        )}
        {narrative && <span className="news-thesis-note">One launch, {narrative.size} stocks. No pick required.</span>}
      </p>
    </aside>
  );
}
