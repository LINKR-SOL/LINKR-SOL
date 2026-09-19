"use client";

import Link from "next/link";
import type { Route } from "next";
import { TrendUp } from "@/components/ui/icons";
import type { ProjectionJson } from "@/lib/api-types";
import { formatAmount, formatNumber, formatUsd, shortAddress, toShares, usdOf } from "@/lib/format";
import { TokenIcon } from "@/components/token-icon";
import { useNow } from "@/lib/hooks/useNow";
import { Badge } from "@/components/ui/primitives";
import { Info } from "@/components/ui/info";
import { CoinTile, segmentColor, segmentColors } from "./vaults-list";
import { PayoutClock } from "./payout-clock";

/** A holder's slice can be a rounding error; "0%" would read as a bug, so name it as small instead. */
function sharePct(ppm: number): string {
  if (ppm > 0 && ppm < 100) return "<0.01%";
  return `${formatNumber(ppm / 10_000, { maxFrac: 2 })}%`;
}

/**
 * What the account is on track to receive when the current period closes.
 *
 * The number is a projection, not a promise, and the card says so plainly: it assumes
 * everyone keeps the balance they hold right now, and the vault keeps collecting.
 */
export function ProjectionCard({ p, now }: { p: ProjectionJson; now: number }) {
  const v = p.vault;
  const symbol = v.launch?.symbol ?? "";
  const label = symbol ? (symbol.startsWith("$") ? symbol : `$${symbol}`) : shortAddress(v.address);
  // the period bar ticks on its own second clock so the percentage climbs 1 → 2 → 3 rather than jumping every 30 s
  const live = useNow(1_000);
  const elapsed = Math.min(1, Math.max(0, (Math.max(live, now) - p.periodStart) / (p.periodEnd - p.periodStart)));
  const colors = segmentColors(v.basket.map((b) => b.mint));
  const colorOf = (a: string) => colors.get(a) ?? segmentColor(a);
  const rows = v.basket
    .map((b, i) => ({ b, amount: p.amounts[i], usd: usdOf(p.amounts[i], b.decimals, b.priceUsd) }))
    .filter((r) => BigInt(r.amount) > 0n);
  const potEmpty = p.potEmpty ?? rows.length === 0;

  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <CoinTile symbol={symbol || "?"} pending={false} logo={v.launch?.logo} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/vaults/${v.address}` as Route} className="font-semibold text-[15px] leading-tight hover:underline">
                {v.launch?.name ?? "Coin"}
              </Link>
              <div className="text-xs text-muted mt-0.5 num">
                {label} · you hold {formatAmount(p.balance, v.launch?.decimals ?? 6, { maxFrac: 0, compact: true })}
              </div>
            </div>
            <span className="inline-flex items-center gap-1">
              <Badge tone="accent">
                <TrendUp size={11} className="inline align-[-1px] mr-1" />
                building up
              </Badge>
              <Info label="What does building up mean?" align="end">
                This coin&apos;s creator fees are being collected and swapped into its stock basket. Nothing is claimable until the current period closes and the payout is published.
              </Info>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-faint">
            Your share so far
            <Info label="How is my share calculated?" align="start">
              Your slice of this period&apos;s pot, weighted by how much you hold and for how long (a time-weighted average). It moves whenever anyone buys or sells until the period closes.
            </Info>
          </div>
          <div className="text-[28px] leading-none font-semibold tracking-tight num mt-1">
            {p.usd !== null ? `≈ ${formatUsd(p.usd)}` : `${sharePct(p.sharePpm)} of the pot`}
          </div>
        </div>
        <div className="text-right text-xs text-muted num shrink-0">
          <div className="text-text font-medium">{sharePct(p.sharePpm)}</div>
          <div className="flex items-center justify-end gap-1">
            of eligible supply
            <Info label="What is eligible supply?" align="end">
              All coins held by real wallets. The bonding curve, the liquidity pool and the vault itself hold coins too, but they are excluded so only holders share the payout.
            </Info>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-faint mb-1.5">
          <span className="inline-flex items-center gap-1">
            Payout period
            <Info label="What is a payout period?" align="start">
              Fees collected during this window are paid out together at its end. The creator chose its length; the clock below shows exactly when this one closes and when the payout becomes claimable.
            </Info>
          </span>
          <span className="num tabular-nums">{Math.floor(elapsed * 100)}% elapsed</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <span className="block h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${Math.max(2, elapsed * 100)}%` }} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/60 bg-surface-2/40 px-3 py-3">
        <PayoutClock periodStart={p.periodStart} periodEnd={p.periodEnd} keeperLag={p.keeperLag ?? 90} disputeWindow={p.disputeWindow ?? 0} potEmpty={potEmpty} compact />
      </div>

      {potEmpty && (
        <p className="mt-3 text-xs text-muted leading-relaxed">
          The pot is empty right now: no creator fees have been harvested since the last payout. Trades on StonkFun are what fill it (0.3% of
          every buy and sell goes to this vault).
        </p>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {rows.map(({ b, amount, usd }) => (
            <li key={b.mint} className="flex items-center gap-2.5 text-sm">
              <TokenIcon symbol={b.symbol} address={b.mint} logoUrl={b.logoUrl} size={24} />
              <span className="font-medium">{b.symbol}</span>
              <span className="text-[11px] num px-1.5 py-0.5 rounded-full" style={{ background: `${colorOf(b.mint)}1f`, color: colorOf(b.mint) }}>
                {b.weightBps / 100}%
              </span>
              <span className="ml-auto text-right num text-xs">
                {formatAmount(toShares(BigInt(amount), b.scaledUi?.multiplier), b.decimals, { maxFrac: 6 })}
                {b.scaledUi ? " sh" : ""}
                {usd !== null && <span className="block text-[10px] text-faint">{formatUsd(usd)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-faint mt-4 leading-relaxed">
        Estimate, not a promise. Your payout is weighted by how long you hold during the period, so this moves whenever anyone buys or sells —{" "}
        {p.holderCount} wallet{p.holderCount === 1 ? "" : "s"} share this one. It becomes claimable once the period closes.
      </p>
    </div>
  );
}
