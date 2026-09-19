"use client";

import { useVaults } from "@/lib/hooks/useApi";
import { formatUsd, toNumber } from "@/lib/format";
import type { TokenJson } from "@/lib/api-types";
import { useReveal } from "./reveal";
import { useCountUp } from "./count-up";

/** USD value of a raw token amount, or 0 while the indexer has no price for it. */
function usdOf(raw: string, token: TokenJson): number {
  const price = Number(token.priceUsd ?? 0);
  if (!price) return 0;
  return toNumber(BigInt(raw), token.decimals) * price;
}

function Stat({
  label,
  value,
  note,
  money = true,
}: {
  label: string;
  value: number;
  note: string;
  money?: boolean;
}) {
  const shown = useCountUp(value);
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{money ? formatUsd(shown) : Math.round(shown)}</strong>
      <small>{note}</small>
    </div>
  );
}

export function StatsBand() {
  const { data } = useVaults();
  const grid = useReveal<HTMLDivElement>({ stagger: true });
  const vaults = data?.vaults ?? [];

  let bought = 0;
  let delivered = 0;
  let payouts = 0;
  for (const v of vaults) {
    payouts += v.epochCount;
    for (const b of v.basket) {
      bought += usdOf(b.harvestedTotal, b);
      const out = BigInt(b.harvestedTotal) - BigInt(b.unallocated) - BigInt(b.allocated);
      if (out > 0n) delivered += usdOf(out.toString(), b);
    }
  }
  const live = vaults.filter((v) => v.status === "active").length;

  return (
    <section className="stats-section" id="activity">
      <div className="stats-header">
        <span>
          <i /> Protocol live
        </span>
        <small>Updated from the LINKR indexer</small>
      </div>
      <div {...grid} className={`stats-grid ${grid.className}`}>
        <Stat label="Stocks bought for holders" value={bought} note={`From ${live} live ${live === 1 ? "coin" : "coins"}`} />
        <Stat label="Delivered to holders" value={delivered} note="Claimed or pushed out" />
        <Stat label="Payouts" value={payouts} note="Periods settled on chain" money={false} />
        <Stat label="Coins launched" value={vaults.length} note="Each with its own stock basket" money={false} />
      </div>
    </section>
  );
}
