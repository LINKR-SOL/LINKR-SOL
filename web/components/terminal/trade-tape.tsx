"use client";

import { useTape, type TapeTrade } from "@/lib/hooks/useTerminal";
import { formatUsd, shortAddress } from "@/lib/format";
import { coinUrl } from "@/lib/token";
import { LiveStatus, agoLabel, useSecondsSince } from "./live-status";

function TradeRow({ trade }: { trade: TapeTrade }) {
  const seconds = useSecondsSince(trade.timestamp * 1000);
  return (
    <a className={`tape-row ${trade.side}`} href={coinUrl(trade.mint)} target="_blank" rel="noreferrer">
      <span className="tape-side">{trade.side === "buy" ? "BUY" : "SELL"}</span>
      <span className="tape-symbol">
        <strong>{trade.symbol}</strong>
        <small>/ {trade.quoteSymbol}</small>
      </span>
      <span className="tape-value">{trade.valueUsd ? formatUsd(trade.valueUsd) : "—"}</span>
      <span className="tape-wallet">{shortAddress(trade.trader)}</span>
      <span className="tape-time">{agoLabel(seconds)}</span>
    </a>
  );
}

/**
 * A merged tape of the most recent trades across the busiest StonkFun coins, when a trade stream is on.
 * It samples a handful of markets rather than the whole network, so it says how many it is watching.
 */
export function TradeTape() {
  const { data, isLoading } = useTape(20);
  const trades = data?.trades ?? [];
  return (
    <div className="tape-panel">
      <div className="tape-panel-head">
        <div>
          <span>Trade tape</span>
          <small>{data?.watched ? `Sampling the ${data.watched} busiest coins on StonkFun` : "Reading the busiest StonkFun markets"}</small>
        </div>
        <LiveStatus fetchedAt={data?.fetchedAt} stale={data?.stale} error={data?.error} empty={!isLoading && trades.length === 0} />
      </div>
      <div className="tape-rows">
        {isLoading && trades.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div className="tape-row is-skeleton" key={i} aria-hidden="true">
              <span className="skeleton skeleton-line" style={{ width: 34 }} />
              <span className="skeleton skeleton-line" style={{ width: "40%" }} />
              <span className="skeleton skeleton-line" style={{ width: "30%" }} />
              <span className="skeleton skeleton-line" style={{ width: "35%" }} />
              <span className="skeleton skeleton-line" style={{ width: "25%" }} />
            </div>
          ))
        ) : trades.length === 0 ? (
          <p className="tape-empty">No trades to show — StonkFun publishes volume, not a trade stream, and no indexer is filling one in.</p>
        ) : (
          trades.map((t) => <TradeRow key={`${t.signature}-${t.timestamp}-${t.symbol}`} trade={t} />)
        )}
      </div>
    </div>
  );
}
