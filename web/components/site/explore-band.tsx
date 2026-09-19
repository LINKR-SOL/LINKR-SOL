"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { ArrowRight, ArrowSquareOut, MagnifyingGlass } from "@/components/ui/icons";
import { useVaults } from "@/lib/hooks/useApi";
import { formatUsd, toNumber } from "@/lib/format";
import type { TokenJson, VaultJson } from "@/lib/api-types";
import { assetMark } from "@/lib/marks";
import { useReveal } from "./reveal";

type Filter = "all" | "paying" | "new";
type Sort = "newest" | "bought" | "payouts" | "period";

function ageLabel(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return hours >= 1 ? `${hours}h` : "new";
}

function periodLabel(seconds: number) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** USD value of a raw token amount, or 0 while the indexer has no price for it. */
function usdOf(raw: string, token: TokenJson): number {
  const price = Number(token.priceUsd ?? 0);
  if (!price) return 0;
  return toNumber(BigInt(raw), token.decimals) * price;
}

/** Total USD of stocks a vault has bought for its holders. */
function boughtUsd(v: VaultJson) {
  return v.basket.reduce((sum, b) => sum + usdOf(b.harvestedTotal, b), 0);
}

function MarkStack({ vault }: { vault: VaultJson }) {
  const shown = vault.basket.slice(0, 4);
  const rest = vault.basket.length - shown.length;
  return (
    <span className="explore-stack" aria-hidden="true">
      {shown.map((t) => {
        const mark = assetMark(t.symbol);
        const src = t.logoUrl ?? mark?.logo;
        return (
          <i className="explore-mark" key={t.mint} title={t.name}>
            {src ? <img alt="" src={src} /> : <span>{t.symbol.slice(0, 1)}</span>}
          </i>
        );
      })}
      {rest > 0 && <i className="explore-more">+{rest}</i>}
    </span>
  );
}

export function ExploreBand() {
  const hero = useReveal<HTMLDivElement>();
  const table = useReveal<HTMLDivElement>({ stagger: true });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const { data, isLoading } = useVaults();
  const vaults = useMemo(() => data?.vaults ?? [], [data]);

  const totals = useMemo(() => {
    let bought = 0;
    let delivered = 0;
    let payouts = 0;
    for (const v of vaults) {
      payouts += v.epochCount;
      for (const b of v.basket) {
        bought += usdOf(b.harvestedTotal, b);
        const out = BigInt(b.harvestedTotal) - BigInt(b.unallocated) - BigInt(b.allocated) - 0n;
        if (out > 0n) delivered += usdOf(out.toString(), b);
      }
    }
    return { bought, delivered, payouts, live: vaults.filter((v) => v.status === "active").length };
  }, [vaults]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = vaults.filter((v) => {
      if (filter === "paying" && v.epochCount === 0) return false;
      if (filter === "new" && v.status !== "pending") return false;
      if (!q) return true;
      return (
        (v.launch?.symbol ?? "").toLowerCase().includes(q) ||
        (v.launch?.name ?? "").toLowerCase().includes(q) ||
        v.basket.some((b) => b.symbol.toLowerCase().includes(q))
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "bought":
          return boughtUsd(b) - boughtUsd(a);
        case "payouts":
          return b.epochCount - a.epochCount;
        case "period":
          return a.epochLength - b.epochLength;
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return sorted;
  }, [vaults, query, filter, sort]);

  const newest = useMemo(
    () => [...vaults].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0],
    [vaults],
  );

  return (
    <section className="explore-section" id="explore">
      <div {...hero} className={`explore-hero ${hero.className}`}>
        <div>
          <span>Explore</span>
          <h2>Coins paying their holders in stocks.</h2>
          <p>Every coin launched through LINKR, with the basket its creator fees are converted into.</p>
        </div>
        <dl>
          <div>
            <dt>Stocks bought</dt>
            <dd>{formatUsd(totals.bought)}</dd>
          </div>
          <div>
            <dt>Delivered</dt>
            <dd>{formatUsd(totals.delivered)}</dd>
          </div>
          <div>
            <dt>Payouts</dt>
            <dd>{totals.payouts}</dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd>{vaults.length}</dd>
          </div>
          <div>
            <dt>Live</dt>
            <dd>{totals.live}</dd>
          </div>
        </dl>
      </div>

      {newest && (
        <div className="explore-highlights">
          <Link className="explore-feature" href={`/vaults/${newest.address}` as Route}>
            <span>Newest coin</span>
            <div>
              <MarkStack vault={newest} />
              <strong>{newest.launch?.symbol ?? "Awaiting launch"}</strong>
              <small>{newest.basket.map((b) => b.symbol).join(" / ")}</small>
            </div>
            <em>
              {formatUsd(boughtUsd(newest))} bought · {ageLabel(newest.createdAt)}
            </em>
          </Link>
        </div>
      )}

      <div className="explore-toolbar">
        <div>
          <span>All coins</span>
          <h3>
            {isLoading && vaults.length === 0
              ? "Loading coins"
              : `${visible.length} ${visible.length === 1 ? "coin" : "coins"}`}
          </h3>
        </div>
        <label className="explore-search">
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input placeholder="Search coin or stock" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="explore-filters">
          {(
            [
              ["all", "All"],
              ["paying", "Paying out"],
              ["new", "Awaiting launch"],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <label className="explore-sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest</option>
            <option value="bought">Stocks bought</option>
            <option value="payouts">Payouts</option>
            <option value="period">Payout period</option>
          </select>
        </label>
      </div>

      <div {...table} className={`explore-table ${table.className}`}>
        <div className="explore-table-head">
          <span>Coin</span>
          <span>Reward basket</span>
          <span>Stocks bought</span>
          <span>Period</span>
          <span>Payouts</span>
          <span>Status</span>
          <span>Age</span>
        </div>
        {isLoading && vaults.length === 0 ? (
          // Without this the table renders "no coins" for the length of the
          // first fetch, which reads as an empty protocol rather than a load.
          Array.from({ length: 4 }).map((_, i) => (
            <div className="explore-row is-skeleton" key={`skeleton-${i}`} aria-hidden="true">
              <span className="explore-pool">
                <span className="skeleton skeleton-mark" />
                <span className="skeleton skeleton-line" style={{ width: "60%" }} />
              </span>
              <span className="skeleton skeleton-line" style={{ width: "70%" }} />
              <span className="skeleton skeleton-line" style={{ width: "50%" }} />
              <span className="skeleton skeleton-line" style={{ width: "40%" }} />
              <span className="skeleton skeleton-line" style={{ width: "50%" }} />
              <span className="skeleton skeleton-line" style={{ width: "30%" }} />
              <span className="skeleton skeleton-line" style={{ width: "40%" }} />
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="explore-empty">
            <p>No coin matches this view yet.</p>
            <Link href={"/launch" as Route}>
              <button type="button">
                Launch the first one
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </Link>
          </div>
        ) : (
          visible.map((vault, i) => (
            <Link className="explore-row" href={`/vaults/${vault.address}` as Route} key={vault.address}>
              <span className="explore-pool">
                <small>{String(i + 1).padStart(2, "0")}</small>
                <MarkStack vault={vault} />
                <span>
                  <strong>{vault.launch?.symbol ?? "—"}</strong>
                  <small>{vault.launch?.name ?? "awaiting launch"}</small>
                </span>
              </span>
              <span className="explore-composition">
                {vault.basket.map((b) => (
                  <em key={b.mint}>
                    {b.symbol}
                    <i>{(b.weightBps / 100).toFixed(0)}%</i>
                  </em>
                ))}
              </span>
              <span>{formatUsd(boughtUsd(vault))}</span>
              <span>{periodLabel(vault.epochLength)}</span>
              <span>{vault.epochCount}</span>
              <span>{vault.status === "active" ? (vault.epochCount > 0 ? "paying" : "collecting") : "pending"}</span>
              <span className="explore-age">
                {ageLabel(vault.createdAt)}
                <ArrowSquareOut size={14} aria-hidden="true" />
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
