"use client";

import { useFeed, usePulse } from "@/lib/hooks/useTerminal";
import { formatNumber, formatUsd } from "@/lib/format";
import { LiveStatus } from "./live-status";

/**
 * The three figures that make the case, read live:
 * how many coins are trading, how many of them already chose a single stock, and how far
 * apart the members of the widest basket moved today.
 *
 * Every cell renders "—" until its number actually arrives.
 */
export function HeroProof() {
  const feed = useFeed("recentBuys", 60);
  const pulse = usePulse();

  const sampled = feed.data?.sampled ?? 0;
  const stockPaired = feed.data?.stockPaired ?? 0;
  const active = feed.data?.data?.activeTotal ?? null;
  const volume24h = pulse.data?.pulse.data?.totals.volumeUsd24h ?? null;

  const widest = [...(pulse.data?.narratives ?? [])]
    .filter((n) => n.spreadPct !== null)
    .sort((a, b) => (b.spreadPct as number) - (a.spreadPct as number))[0];

  const down = !feed.isLoading && sampled === 0;

  return (
    <div className="hero-proof">
      <div className="hero-proof-cell">
        <span>Coins trading on StonkFun</span>
        <strong>{active === null ? "—" : formatNumber(active, { compact: true })}</strong>
        <small>{volume24h === null ? "live launchpad" : `${formatUsd(volume24h, { compact: true })} traded in 24h`}</small>
      </div>

      <div className="hero-proof-cell accent">
        <span>Already paired to one stock</span>
        <strong>{sampled ? `${stockPaired} of ${sampled}` : "—"}</strong>
        <small>in the coins trading right now</small>
      </div>

      <div className="hero-proof-cell">
        <span>{widest ? `${widest.name} today` : "Widest basket today"}</span>
        <strong>{widest ? `${widest.spreadPct?.toFixed(1)} pts` : "—"}</strong>
        <small>{widest ? `${widest.best?.symbol} to ${widest.worst?.symbol} — the cost of guessing` : "between best and worst name"}</small>
      </div>

      <LiveStatus
        fetchedAt={feed.data?.fetchedAt}
        stale={feed.data?.stale}
        error={feed.data?.error}
        empty={down}
        label="Live"
      />
    </div>
  );
}
