"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CaretRight, MagnifyingGlass } from "@/components/ui/icons";
import type { Route } from "next";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVaults } from "@/lib/hooks/useApi";
import { formatAmount, formatUsd, shortAddress, timeAgo, toShares, usdOf } from "@/lib/format";
import { TokenIcon } from "@/components/token-icon";
import { Relative } from "@/components/ui/live-time";
import { Badge, EmptyState, Input, Skeleton, Tabs } from "@/components/ui/primitives";
import type { VaultJson, VaultBasketJson } from "@/lib/api-types";

export function vaultBadge(v: VaultJson) {
  // green = running (the state creators are waiting for); orange/warn = something still has to happen
  if (v.status === "pending" && v.pendingLaunch) return <Badge tone="warn">binding…</Badge>;
  if (v.status === "pending") return <Badge tone="warn">awaiting launch</Badge>;
  if (v.epochCount > 0) return <Badge tone="success">live · {v.epochCount} payout{v.epochCount === 1 ? "" : "s"}</Badge>;
  if (v.harvestCount > 0) return <Badge tone="success">live · collecting</Badge>;
  return <Badge tone="success">live</Badge>;
}

/** Stable colour per stock, so a token keeps the same segment colour across the bar and the rows. */
const SEGMENT = ["#b8391a", "#0f6b78", "#15703f", "#26409e", "#7d5c0e", "#9c1f1f", "#1a4f96", "#10656f", "#5e2a8c", "#8c1f5e"];
export function segmentColor(address: string) {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return SEGMENT[h % SEGMENT.length];
}

/** Colours for one basket, guaranteed distinct: a collision takes the next free colour. */
export function segmentColors(addresses: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const a of addresses) {
    const start = SEGMENT.indexOf(segmentColor(a));
    let color = SEGMENT[start];
    for (let i = 1; used.has(color) && i < SEGMENT.length; i++) color = SEGMENT[(start + i) % SEGMENT.length];
    used.add(color);
    out.set(a, color);
  }
  return out;
}

/** The coin's own artwork, falling back to a monogram when a launch shipped without one. */
export function CoinTile({ symbol, pending, logo, size = 56 }: { symbol: string; pending: boolean; logo?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" width={size} height={size} onError={() => setFailed(true)} className="rounded-2xl shrink-0 object-cover bg-surface-2" style={{ width: size, height: size }} />
    );
  }
  return <CoinMonogram symbol={symbol} pending={pending} size={size} />;
}

function CoinMonogram({ symbol, pending, size }: { symbol: string; pending: boolean; size: number }) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const a = SEGMENT[h % SEGMENT.length];
  const b = SEGMENT[(h >>> 3) % SEGMENT.length];
  return (
    <span
      className="grid place-items-center rounded-2xl shrink-0 text-white font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.32),
        letterSpacing: "-0.02em",
        background: pending ? "var(--soft)" : `linear-gradient(140deg, ${a}, ${b})`,
        color: pending ? "var(--muted-light)" : undefined,
      }}
      aria-hidden
    >
      {pending ? "—" : symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()}
    </span>
  );
}

function paidOut(b: VaultBasketJson) {
  const amount = formatAmount(toShares(BigInt(b.harvestedTotal), b.scaledUi?.multiplier), b.decimals, { maxFrac: 4 });
  return { amount, unit: b.scaledUi ? "sh" : "", usd: usdOf(b.harvestedTotal, b.decimals, b.priceUsd) };
}

/** What the whole basket the vault is holding is worth. */
function basketUsd(v: VaultJson): number | null {
  let total = 0;
  let priced = false;
  for (const b of v.basket) {
    const u = usdOf(b.harvestedTotal, b.decimals, b.priceUsd);
    if (u !== null) {
      total += u;
      priced = true;
    }
  }
  return priced ? total : null;
}

function VaultCard({ v }: { v: VaultJson }) {
  const launch = v.launch ?? v.pendingLaunch;
  const pending = v.status === "pending" && !v.pendingLaunch;
  const symbol = launch?.symbol ?? "";
  const name = launch?.name ?? (pending ? "Awaiting launch" : "Coin");
  const anyPaid = v.basket.some((b) => BigInt(b.harvestedTotal) > 0n);
  const total = basketUsd(v);
  const hasNext = v.nextEpochAt !== null && v.status === "active";
  const colors = segmentColors(v.basket.map((b) => b.mint));
  const colorOf = (a: string) => colors.get(a) ?? segmentColor(a);

  return (
    <Link
      href={`/vaults/${v.address}` as Route}
      className="group block min-w-0 rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-[transform,border-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:border-border-strong hover:shadow-[var(--shadow-soft)] active:scale-[0.994]"
    >
      <div className="flex items-start gap-3">
        <CoinTile symbol={symbol || name || "?"} pending={pending} logo={launch?.logo} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-[15px] leading-tight truncate">{name}</div>
              <div className="text-xs text-muted mt-0.5 num">{symbol ? (symbol.startsWith("$") ? symbol : `$${symbol}`) : shortAddress(v.address)}</div>
            </div>
            {vaultBadge(v)}
          </div>
          <div className="text-[11px] text-faint mt-2 num truncate">
            by {shortAddress(v.creator)} · {timeAgo(v.createdAt)}
            {hasNext && (
              <>
                {" "}· next payout <Relative target={v.nextEpochAt!} past="due now" />
              </>
            )}
            {launch?.complete && <> · graduated to Raydium</>}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-faint mb-1.5">
          <span>Holders paid in</span>
          <span>
            {total ? <span className="text-text font-medium">{formatUsd(total)} bought</span> : null}
            {total ? " · " : null}
            {v.basket.length} stock{v.basket.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-surface-2" role="img" aria-label="payout split">
          {v.basket.map((b) => (
            <span key={b.mint} style={{ width: `${b.weightBps / 100}%`, background: colorOf(b.mint) }} title={`${b.symbol} ${b.weightBps / 100}%`} />
          ))}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {v.basket.map((b) => {
          const { amount, unit, usd } = paidOut(b);
          const paid = BigInt(b.harvestedTotal) > 0n;
          return (
            <li key={b.mint} className="flex items-center gap-2.5 text-sm">
              <TokenIcon symbol={b.symbol} address={b.mint} logoUrl={b.logoUrl} size={26} />
              <span className="font-medium">{b.symbol}</span>
              <span className="text-[11px] num px-1.5 py-0.5 rounded-full" style={{ background: `${colorOf(b.mint)}1f`, color: colorOf(b.mint) }}>
                {b.weightBps / 100}%
              </span>
              <span className={`ml-auto text-right num text-xs ${paid ? "text-text" : "text-faint"}`}>
                {amount}
                {unit && ` ${unit}`}
                {usd !== null && paid && <span className="block text-[10px] text-faint">{formatUsd(usd)}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {v.harvestCount > 0 && (
        <p className="text-[11px] text-faint mt-3 num">
          {v.harvestCount} harvest{v.harvestCount === 1 ? "" : "s"} · fees converted automatically
        </p>
      )}
      {!anyPaid && (
        <p className="text-[11px] text-faint mt-3">
          {v.pendingLaunch ? "Just launched — the vault is being bound, then fees start flowing." : pending ? "Launch the coin to start collecting fees." : "No fees converted yet."}
        </p>
      )}
    </Link>
  );
}

const SORTS = [
  { value: "new", label: "Newest" },
  { value: "paid", label: "Most paid out" },
  { value: "soon", label: "Next payout" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

/** Everything worth matching a query against: the coin, its creator, and the stocks it pays. */
function haystack(v: VaultJson): string {
  return [v.launch?.name, v.launch?.symbol, v.address, v.creator, v.launchMint, ...v.basket.flatMap((b) => [b.symbol, b.name])].filter(Boolean).join(" ").toLowerCase();
}

/** A vault counts as launched once its coin exists — including the minute or two before the keeper binds it. */
function isLaunched(v: VaultJson): boolean {
  return v.status === "active" || v.pendingLaunch !== null;
}

export function VaultsList({ mineOnly = false }: { mineOnly?: boolean }) {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const { data, isLoading } = useVaults(mineOnly ? { creator: address } : {});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [waitingOpen, setWaitingOpen] = useState<boolean | null>(null);

  const { live, waiting } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.vaults ?? []).filter((v) => q === "" || haystack(v).includes(q));
    const by: Record<Sort, (a: VaultJson, b: VaultJson) => number> = {
      new: () => 0,
      paid: (a, b) => (basketUsd(b) ?? -1) - (basketUsd(a) ?? -1),
      soon: (a, b) => (a.nextEpochAt ?? Infinity) - (b.nextEpochAt ?? Infinity),
    };
    const sorted = [...list].sort(by[sort]);
    return { live: sorted.filter(isLaunched), waiting: sorted.filter((v) => !isLaunched(v)) };
  }, [data, query, sort]);

  if (mineOnly && !address) return null;
  if (isLoading) {
    return (
      <div className="grid sm:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }
  const vaults = data?.vaults ?? [];
  if (vaults.length === 0) {
    return <EmptyState title="No vaults yet" body="Launch a coin and choose the stocks its holders are paid in." action={{ href: "/launch" as Route, label: "Launch" }} />;
  }
  const showWaiting = waitingOpen ?? query.trim() !== "";

  return (
    <div className="space-y-4">
      {vaults.length > 4 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setWaitingOpen(null);
              }}
              placeholder="Search coins, creators or stocks"
              aria-label="Search vaults"
              className="pl-9"
            />
          </div>
          <Tabs value={sort} onChange={setSort} options={SORTS as unknown as { value: Sort; label: string }[]} />
        </div>
      )}
      {live.length === 0 && waiting.length === 0 && <EmptyState title="No vaults match that" body="Try a coin name, a creator address, or a stock ticker like TSLA." />}
      {live.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {live.map((v) => (
            <VaultCard key={v.address} v={v} />
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setWaitingOpen(!showWaiting)}
            aria-expanded={showWaiting}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted transition-[background-color,border-color] duration-150 ease-[var(--ease-out)] hover:border-border-strong hover:text-text active:scale-[0.997]"
          >
            <CaretRight size={14} className="shrink-0 transition-transform duration-200 ease-[var(--ease-out)]" style={{ transform: showWaiting ? "rotate(90deg)" : "none" }} />
            <span>
              {waiting.length} vault{waiting.length === 1 ? "" : "s"} awaiting launch
            </span>
            <span className="ml-auto text-xs text-faint">{showWaiting ? "Hide" : "Show"}</span>
          </button>
          {showWaiting && (
            <div className="grid sm:grid-cols-2 gap-4">
              {waiting.map((v) => (
                <VaultCard key={v.address} v={v} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
