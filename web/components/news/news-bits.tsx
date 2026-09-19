"use client";

import { useMemo, useState } from "react";
import { usePulse } from "@/lib/hooks/useTerminal";
import type { StockQuote } from "@/lib/xstocks/quotes";
import { PairMark } from "@/components/site/pair-mark";
import { CATEGORY_LABEL, type NewsItem } from "@/lib/news/types";

/** Live quotes keyed by symbol, so a headline's tickers can carry today's real move.
 *  The query is the same one the rest of the terminal uses — react-query dedupes it. */
export function useQuoteMap(): Map<string, StockQuote> {
  const { data } = usePulse();
  return useMemo(() => new Map((data?.stocks.quotes ?? []).map((q) => [q.symbol, q])), [data]);
}

/**
 * Tickers a story is about, priced live where we can price them.
 *
 * A symbol with no quote renders as a plain chip rather than a zero — the whole point of
 * the join is that the number is real when it is shown at all.
 */
export function TickerChips({ symbols, max = 3 }: { symbols: string[]; max?: number }) {
  const quotes = useQuoteMap();
  if (symbols.length === 0) return null;
  const shown = symbols.slice(0, max);
  const rest = symbols.length - shown.length;

  return (
    <span className="news-tickers">
      {shown.map((s) => {
        const q = quotes.get(s);
        const change = q?.change24h ?? null;
        return (
          <em key={s} className={`news-ticker${change === null ? "" : change < 0 ? " down" : " up"}`}>
            <PairMark symbol={s} small logoUrl={q?.logoUrl} />
            {s}
            {change !== null && (
              <b>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}%
              </b>
            )}
          </em>
        );
      })}
      {rest > 0 && <em className="news-ticker muted">+{rest}</em>}
    </span>
  );
}

export function CategoryChip({ item }: { item: NewsItem }) {
  return <span className="news-cat">{CATEGORY_LABEL[item.category]}</span>;
}

/**
 * Story artwork.
 *
 * Providers hand out image URLs that 404 as often as not, so a failed load falls back to
 * the mark of the story's first ticker, and a story with no ticker falls back to a
 * monogram of its source. There is never a broken frame.
 */
export function NewsThumb({ item, size = "sm" }: { item: NewsItem; size?: "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const quotes = useQuoteMap();
  const ticker = item.tickers[0];
  const cls = `news-thumb ${size}`;

  if (item.imageUrl && !failed) {
    return (
      <span className={cls}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={item.imageUrl} loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }

  if (ticker) {
    return (
      <span className={`${cls} mark`} aria-hidden="true">
        <PairMark symbol={ticker} logoUrl={quotes.get(ticker)?.logoUrl} />
      </span>
    );
  }

  return (
    <span className={`${cls} letter`} aria-hidden="true">
      {item.source.name.replace(/^(the|a)\s+/i, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Says out loud that the wire is showing the built-in design sample, not reporting. */
export function SampleBadge({ compact = false }: { compact?: boolean }) {
  return (
    <em className={`news-sample${compact ? " compact" : ""}`} title="Design sample — no news provider is connected yet. Nothing here is reporting.">
      Sample
    </em>
  );
}
