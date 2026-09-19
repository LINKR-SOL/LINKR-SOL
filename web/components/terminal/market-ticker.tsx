"use client";

import { usePulse } from "@/lib/hooks/useTerminal";
import { PairMark } from "@/components/site/pair-mark";

/**
 * Marquee of live tokenised-stock moves, read from the chain's deepest pools.
 *
 * Before any quote has arrived the strip renders its own shell rather than a set of
 * placeholder tickers — an invented +5.89% is exactly the kind of detail that makes a
 * live product read as a mockup.
 */
export function MarketTicker() {
  const { data, isLoading } = usePulse();
  const quotes = (data?.stocks.quotes ?? []).filter((q) => q.change24h !== null).slice(0, 18);

  if (quotes.length === 0) {
    return (
      <div className="activity-tape" aria-hidden="true">
        <div className="tape-static">
          {isLoading ? "Loading tokenised stock quotes…" : "Stock quotes unavailable — the pool indexer is not responding"}
        </div>
      </div>
    );
  }

  // Two identical groups so the -50% keyframe loops seamlessly.
  const doubled = [...quotes, ...quotes];

  return (
    <div className="activity-tape" aria-label="Live tokenised stock prices on Solana">
      <div className="tape-track">
        {[0, 1].map((group) => (
          <div className="tape-group" key={group} aria-hidden={group === 1}>
            {doubled.map((q, i) => (
              <span className="tape-item" key={`${group}-${q.symbol}-${i}`}>
                <PairMark symbol={q.symbol} small logoUrl={q.logoUrl} />
                <strong>{q.symbol}</strong>
                <b>
                  $
                  {q.priceUsd >= 1000
                    ? q.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })
                    : q.priceUsd.toFixed(2)}
                </b>
                <em className={(q.change24h ?? 0) < 0 ? "negative" : ""}>
                  {(q.change24h ?? 0) >= 0 ? "+" : ""}
                  {(q.change24h ?? 0).toFixed(2)}%
                </em>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
