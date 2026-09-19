"use client";

import { TrendUp } from "@/components/ui/icons";
import type { TokenJson } from "@/lib/api-types";
import { TokenIcon } from "@/components/token-icon";
import { Badge } from "@/components/ui/primitives";
import { segmentColor, segmentColors } from "@/components/vaults/vaults-list";

export interface PreviewItem {
  token: TokenJson;
  weight: number;
}

/** "every 7 days" — the wizard's own option labels, restated the way a holder would read it. */
function cadence(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const d = seconds / 86_400;
    return d === 1 ? "every day" : d === 7 ? "every week" : `every ${d} days`;
  }
  const h = Math.round(seconds / 3600);
  return h === 1 ? "every hour" : `every ${h} hours`;
}

/**
 * The card a holder will see on /claims and /vaults once this coin is live, drawn from whatever
 * the wizard has so far.
 *
 * A creator is choosing a basket in the abstract — sliders and percentages — with no sense of what
 * they are actually shipping. Showing the holder's view while they choose makes the decision
 * concrete, and it is the same layout the live pages use, so nothing is a surprise afterwards.
 */
export function HolderPreview({
  name,
  symbol,
  logo,
  basket,
  epochLength,
}: {
  name: string;
  symbol: string;
  logo: string;
  basket: PreviewItem[];
  epochLength: number;
}) {
  const label = symbol.trim() ? `$${symbol.trim().replace(/^\$/, "").toUpperCase()}` : "$YOURCOIN";
  const total = basket.reduce((s, a) => s + a.weight, 0);
  const colors = segmentColors(basket.map((a) => a.token.mint));
  const colorOf = (a: string) => colors.get(a) ?? segmentColor(a);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        {logo.trim() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" width={44} height={44} className="rounded-2xl shrink-0 object-cover bg-surface-2" style={{ width: 44, height: 44 }} />
        ) : (
          <span className="grid place-items-center rounded-2xl shrink-0 bg-surface-2 text-faint" style={{ width: 44, height: 44 }} aria-hidden>
            —
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-[15px] leading-tight truncate">{name.trim() || "Your coin"}</div>
              <div className="text-xs text-muted mt-0.5 num">{label} · you hold 10,000</div>
            </div>
            <Badge tone="accent">
              <TrendUp size={11} className="inline align-[-1px] mr-1" />
              building up
            </Badge>
          </div>
        </div>
      </div>

      {basket.length === 0 ? (
        <p className="text-sm text-faint mt-4">Pick the stocks your holders are paid in and they show up here.</p>
      ) : (
        <>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-faint mb-1.5">
              <span>Paid in</span>
              <span>
                {basket.length} stock{basket.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-surface-2" role="img" aria-label="payout split">
              {basket.map((a) => (
                <span
                  key={a.token.mint}
                  style={{ width: `${total > 0 ? (a.weight / total) * 100 : 0}%`, background: colorOf(a.token.mint) }}
                  className="transition-[width] duration-300 ease-[var(--ease-out)]"
                />
              ))}
            </div>
          </div>

          <ul className="mt-3 space-y-1.5">
            {basket.map((a) => (
              <li key={a.token.mint} className="flex items-center gap-2.5 text-sm">
                <TokenIcon symbol={a.token.symbol} address={a.token.mint} logoUrl={a.token.logoUrl} size={24} />
                <span className="font-medium">{a.token.symbol}</span>
                <span
                  className="text-[11px] num px-1.5 py-0.5 rounded-full"
                  style={{ background: `${colorOf(a.token.mint)}1f`, color: colorOf(a.token.mint) }}
                >
                  {a.weight}%
                </span>
                <span className="ml-auto text-right num text-xs text-faint">{a.token.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-[11px] text-faint mt-4 leading-relaxed">
        Holders are paid {cadence(epochLength)} from your StonkFun creator fees, split by how much they held and for
        how long. Nothing to claim until the first period closes.
      </p>
    </div>
  );
}
