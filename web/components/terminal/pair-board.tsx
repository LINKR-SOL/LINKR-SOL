"use client";

import { useFeed } from "@/lib/hooks/useTerminal";
import { PairMark } from "@/components/site/pair-mark";
import { LiveStatus } from "./live-status";

/**
 * What the coins trading right now are actually priced in.
 *
 * Read straight off the live feed's `pairToken`s. The stock rows are the interesting
 * ones: each is somebody who wanted a stock-shaped launch and had to compress it into a
 * single ticker.
 */
export function PairBoard() {
  const { data, isLoading } = useFeed("recentBuys", 60);
  const pairing = data?.pairing ?? [];
  const sampled = data?.sampled ?? 0;
  const max = pairing[0]?.count ?? 1;
  const stockRows = pairing.filter((p) => p.kind === "stock");

  return (
    <div className="pairboard">
      <div className="pairboard-head">
        <div>
          <span>Priced in</span>
          <small>{sampled ? `Across ${sampled} live coins` : "Reading the live feed"}</small>
        </div>
        <LiveStatus fetchedAt={data?.fetchedAt} stale={data?.stale} error={data?.error} empty={!isLoading && pairing.length === 0} />
      </div>

      {pairing.length === 0 ? (
        <p className="tape-empty">{isLoading ? "Reading the feed…" : "Feed unavailable."}</p>
      ) : (
        <>
          <div className="pairboard-rows">
            {pairing.slice(0, 9).map((p) => (
              <div className={`pairboard-row ${p.kind}`} key={p.symbol}>
                <PairMark symbol={p.symbol} small logoUrl={p.logoUrl} />
                <strong>{p.symbol}</strong>
                <span className="pairboard-bar">
                  <i style={{ width: `${Math.max(4, (p.count / max) * 100)}%` }} />
                </span>
                <em>{p.count}</em>
              </div>
            ))}
          </div>
          {stockRows.length > 0 && (
            <p className="pairboard-note">
              <strong>{stockRows.length} different stocks</strong> are being used as pair assets right now — one coin,
              one ticker, every time.
            </p>
          )}
        </>
      )}
    </div>
  );
}
