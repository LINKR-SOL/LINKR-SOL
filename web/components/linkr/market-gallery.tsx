"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useFeed } from "@/lib/hooks/useTerminal";
import { useVaults } from "@/lib/hooks/useApi";
import { useNow } from "@/lib/hooks/useNow";
import { ArrowRight, ArrowUpRight, CaretDown, MagnifyingGlass, X } from "@/components/ui/icons";
import { BrandMark } from "@/components/site/brand";
import { TokenIcon } from "@/components/token-icon";
import { EPOCH_OPTIONS } from "@/lib/launch/options";
import { formatUsd, timeAgo, usdOf } from "@/lib/format";
import type { FeedSort } from "@/lib/stonkfun/live";
import { MotionSurface } from "./motion";

export function StateMessage({ title, body, retry, action }: { title: string; body: string; retry?: () => void; action?: ReactNode }) {
  return (
    <div className="lk-state">
      <span className="state-orbit"><BrandMark size={44} /></span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
        {retry && <button onClick={retry} className="text-action">Try again <ArrowRight size={15} /></button>}
        {action}
      </div>
    </div>
  );
}

/** A coin's own image; its ticker when it has none or the image fails to load. A plain <img>: logos come from any
 *  host (Vercel Blob, IPFS), which next/image isn't configured for. */
function CoinLogo({ logo, symbol }: { logo: string | null; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="mk-coin-img" src={logo} alt="" width={56} height={56} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <span className="mk-coin-fallback">{symbol.slice(0, 4) || "LINK"}</span>;
}

// ─── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type Token = { symbol: string; mint: string; logoUrl: string | null };
type LinkrRow = {
  kind: "linkr";
  id: string; name: string; symbol: string; logo: string | null; href: string;
  launchedAt: number;
  basket: (Token & { weight: number })[];
  pair: Token;
  period: number;
  nextPayoutAt: number | null;
  payouts: number;
  feesUsd: number | null;
};
type FeedRow = {
  kind: "feed";
  id: string; name: string; symbol: string; logo: string | null; href: string; external: boolean;
  launchedAt: number;
  pair: Token & { kind: string };
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  graduated: boolean;
  progress: number;
  linkr: boolean;
};

const spell = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`);
const periodLabel = (s: number) => EPOCH_OPTIONS.find((o) => o.seconds === s)?.label ?? `Every ${spell(s)}`;
/** The same period, short enough for a tile's stat column. */
const periodShort = (s: number) =>
  ({ 600: "10 min", 3600: "Hourly", 43200: "12 hours", 86400: "Daily", 259200: "3 days", 604800: "Weekly", 1209600: "2 weeks", 2592000: "Monthly" })[s] ?? spell(s);
const PAIR_KINDS: Record<string, string> = {
  solana: "SOL", currency: "Stablecoins", xstock: "xStocks", prestock: "PreStocks", backpack: "Sunrise",
  leverage: "Leverage", collectible: "Collectibles", custom: "Custom",
};
function untilLabel(at: number | null, now: number): string {
  if (at === null) return "not scheduled";
  if (now <= 0) return "soon";
  const s = at - now;
  if (s <= 0) return "settling now";
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `in ${Math.floor(s / 86400)}d`;
}
const age = (ms: number) => timeAgo(new Date(ms)).replace(" ago", "");

const LINKR_SORTS = [
  { key: "newest", label: "Newest" },
  { key: "fees", label: "Most fees earned" },
  { key: "payouts", label: "Most payouts" },
  { key: "next", label: "Next payout" },
  { key: "stocks", label: "Most stocks" },
  { key: "name", label: "Name A–Z" },
] as const;
type LinkrSort = (typeof LINKR_SORTS)[number]["key"];
const FEED_SORTS: { key: FeedSort; label: string }[] = [
  { key: "marketCap", label: "Market cap" },
  { key: "recentBuys", label: "Recent trades" },
  { key: "newest", label: "Newest" },
  { key: "graduating", label: "Near graduation" },
  { key: "graduated", label: "Graduated" },
];

function sortLinkr(rows: LinkrRow[], sort: LinkrSort): LinkrRow[] {
  const by = [...rows];
  const n = (v: number | null) => v ?? -1;
  switch (sort) {
    case "fees": return by.sort((a, b) => n(b.feesUsd) - n(a.feesUsd) || b.launchedAt - a.launchedAt);
    case "payouts": return by.sort((a, b) => b.payouts - a.payouts || n(b.feesUsd) - n(a.feesUsd));
    case "next": return by.sort((a, b) => (a.nextPayoutAt ?? Infinity) - (b.nextPayoutAt ?? Infinity));
    case "stocks": return by.sort((a, b) => b.basket.length - a.basket.length || b.launchedAt - a.launchedAt);
    case "name": return by.sort((a, b) => a.name.localeCompare(b.name));
    default: return by.sort((a, b) => b.launchedAt - a.launchedAt);
  }
}

// ─── pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────
function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" className="mk-chip" aria-pressed={on} onClick={onClick}>
      {children}
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}

function SortSelect<K extends string>({ value, options, onChange }: { value: K; options: readonly { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <label className="mk-sort">
      <span>Sort</span>
      <select value={value} onChange={(e) => onChange(e.target.value as K)} aria-label="Sort markets">
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <CaretDown size={14} aria-hidden="true" />
    </label>
  );
}

function LinkrTile({ row, now }: { row: LinkrRow; now: number }) {
  const shown = row.basket.slice(0, 4);
  const more = row.basket.length - shown.length;
  return (
    <Link className="mk-tile glass" href={row.href}>
      <div className="mk-tile-top">
        <span className="mk-coin"><CoinLogo logo={row.logo} symbol={row.symbol} /></span>
        <div className="mk-id">
          <h3>{row.name}</h3>
          <small>${row.symbol} · {age(row.launchedAt)}</small>
        </div>
        <ArrowUpRight className="mk-go" size={18} />
      </div>
      <span className="mk-label">Pays holders in</span>
      <ul className="mk-stocks">
        {shown.map((b) => (
          <li key={b.mint}>
            <TokenIcon symbol={b.symbol} address={b.mint} logoUrl={b.logoUrl} size={16} />
            {b.symbol}
            <em>{b.weight}%</em>
          </li>
        ))}
        {more > 0 && <li className="mk-more">+{more}</li>}
      </ul>
      <dl className="mk-stats">
        <div><dt>Pair</dt><dd><TokenIcon symbol={row.pair.symbol} address={row.pair.mint} logoUrl={row.pair.logoUrl} size={14} />{row.pair.symbol}</dd></div>
        <div><dt>Pays out</dt><dd>{periodShort(row.period)}</dd></div>
        <div><dt>Fees earned</dt><dd className="num">{row.feesUsd === null ? "–" : formatUsd(row.feesUsd)}</dd></div>
      </dl>
      <div className="mk-foot">
        <span className="mk-live"><i aria-hidden="true" />Next payout {untilLabel(row.nextPayoutAt, now)}</span>
        <span>{row.payouts === 0 ? "No payouts yet" : `${row.payouts} paid`}</span>
      </div>
    </Link>
  );
}

function FeedTile({ row }: { row: FeedRow }) {
  const inner = (
    <>
      <div className="mk-tile-top">
        <span className="mk-coin"><CoinLogo logo={row.logo} symbol={row.symbol} /></span>
        <div className="mk-id">
          <h3>{row.name}</h3>
          <small>${row.symbol} · {age(row.launchedAt)}</small>
        </div>
        <ArrowUpRight className="mk-go" size={18} />
      </div>
      {row.linkr && <span className="mk-badge">Pays holders in stocks</span>}
      <dl className="mk-stats">
        <div><dt>Pair</dt><dd><TokenIcon symbol={row.pair.symbol} address={row.pair.mint} logoUrl={row.pair.logoUrl} size={14} />{row.pair.symbol}</dd></div>
        <div><dt>Market cap</dt><dd className="num">{formatUsd(row.marketCapUsd, { compact: true })}</dd></div>
        <div><dt>24h volume</dt><dd className="num">{formatUsd(row.volume24hUsd, { compact: true })}</dd></div>
      </dl>
      <div className="mk-foot">
        {row.graduated ? (
          <span className="mk-live"><i aria-hidden="true" />Graduated to Raydium</span>
        ) : (
          <span className="mk-curve">
            <span className="mk-curve-bar"><span style={{ width: `${Math.min(100, Math.max(2, row.progress))}%` }} /></span>
            Bonding curve {Math.round(row.progress)}%
          </span>
        )}
      </div>
    </>
  );
  return row.external ? (
    <a className="mk-tile glass" href={row.href} target="_blank" rel="noreferrer">{inner}</a>
  ) : (
    <Link className="mk-tile glass" href={row.href}>{inner}</Link>
  );
}

// ─── the gallery ──────────────────────────────────────────────────────────────────────────────────────────────────
export function MarketGallery({ full = false }: { full?: boolean }) {
  const [tab, setTab] = useState<"linkr" | "all">("linkr");
  const [query, setQuery] = useState("");
  const [linkrSort, setLinkrSort] = useState<LinkrSort>("newest");
  const [feedSort, setFeedSort] = useState<FeedSort>("marketCap");
  const [stocks, setStocks] = useState<string[]>([]);
  const [pair, setPair] = useState<string | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [pairKind, setPairKind] = useState<string | null>(null);
  const [stockOnly, setStockOnly] = useState(false);
  const reduced = useReducedMotion();
  const now = useNow(15_000);

  const vaults = useVaults();
  const feed = useFeed(feedSort, full ? 60 : 24);

  const linkrRows = useMemo<LinkrRow[]>(
    () =>
      (vaults.data?.vaults ?? [])
        .filter((v) => v.status === "active" && v.launch)
        .map((v) => ({
          kind: "linkr",
          id: v.address,
          name: v.launch!.name,
          symbol: v.launch!.symbol,
          logo: v.launch!.logo,
          href: `/vaults/${v.address}`,
          launchedAt: new Date(v.launch!.launchedAt).getTime(),
          basket: v.basket.map((b) => ({ symbol: b.symbol, mint: b.mint, logoUrl: b.logoUrl ?? null, weight: Math.round(b.weightBps / 100) })),
          pair: { symbol: v.quote.symbol, mint: v.quote.mint, logoUrl: v.quote.logoUrl ?? null },
          period: v.epochLength,
          nextPayoutAt: v.nextEpochAt,
          payouts: v.epochCount,
          feesUsd: usdOf(v.inputTotal, v.quote.decimals, v.quote.priceUsd),
        })),
    [vaults.data],
  );
  const feedRows = useMemo<FeedRow[]>(
    () =>
      (feed.data?.data?.launches ?? []).map((l) => ({
        kind: "feed",
        id: l.mint,
        name: l.name,
        symbol: l.symbol,
        logo: l.logo,
        href: l.vault ? `/vaults/${l.vault}` : `https://www.stonkfun.xyz/token/${l.mint}`,
        external: !l.vault,
        launchedAt: new Date(l.launchedAt).getTime(),
        pair: { symbol: l.quote.symbol, mint: l.quote.mint, logoUrl: l.quote.logoUrl, kind: l.quote.kind },
        marketCapUsd: l.marketCapUsd,
        volume24hUsd: l.volume24hUsd,
        graduated: l.graduated,
        progress: l.graduationProgressPct,
        linkr: l.causaVaulted,
      })),
    [feed.data],
  );

  // facets, with how many markets each would show
  const stockFacets = useMemo(() => {
    const m = new Map<string, Token & { count: number }>();
    for (const r of linkrRows) for (const b of r.basket) {
      const f = m.get(b.symbol) ?? { ...b, count: 0 };
      f.count += 1;
      m.set(b.symbol, f);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
  }, [linkrRows]);
  const pairFacets = useMemo(() => {
    const m = new Map<string, Token & { count: number }>();
    for (const r of linkrRows) { const f = m.get(r.pair.symbol) ?? { ...r.pair, count: 0 }; f.count += 1; m.set(r.pair.symbol, f); }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [linkrRows]);
  const periodFacets = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of linkrRows) m.set(r.period, (m.get(r.period) ?? 0) + 1);
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [linkrRows]);
  const kindFacets = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of feedRows) m.set(r.pair.kind, (m.get(r.pair.kind) ?? 0) + 1);
    return [...m].filter(([k]) => PAIR_KINDS[k]).sort((a, b) => b[1] - a[1]);
  }, [feedRows]);

  const q = query.trim().toLowerCase();
  const linkrList = useMemo(() => {
    const hit = linkrRows.filter(
      (r) =>
        (!q || [r.name, r.symbol, r.pair.symbol, ...r.basket.map((b) => b.symbol)].join(" ").toLowerCase().includes(q)) &&
        (!stocks.length || r.basket.some((b) => stocks.includes(b.symbol))) &&
        (!pair || r.pair.symbol === pair) &&
        (!period || r.period === period),
    );
    return sortLinkr(hit, linkrSort);
  }, [linkrRows, q, stocks, pair, period, linkrSort]);
  const feedList = useMemo(
    () =>
      feedRows.filter(
        (r) =>
          (!q || [r.name, r.symbol, r.pair.symbol].join(" ").toLowerCase().includes(q)) &&
          (!pairKind || r.pair.kind === pairKind) &&
          (!stockOnly || r.linkr),
      ),
    [feedRows, q, pairKind, stockOnly],
  );

  const isLinkr = tab === "linkr";
  const list: (LinkrRow | FeedRow)[] = isLinkr ? linkrList : feedList;
  const total = isLinkr ? linkrRows.length : feedRows.length;
  const shown = full ? list : list.slice(0, 8);
  const loading = isLinkr ? vaults.isLoading : feed.isLoading && !feed.data;
  const failed = isLinkr ? !!vaults.error : !!feed.error || !!feed.data?.error;
  const filtered = !!q || (isLinkr ? stocks.length > 0 || !!pair || !!period : !!pairKind || stockOnly);
  const clear = () => { setQuery(""); setStocks([]); setPair(null); setPeriod(null); setPairKind(null); setStockOnly(false); };

  const summary = useMemo(() => {
    const fees = linkrRows.reduce((s, r) => s + (r.feesUsd ?? 0), 0);
    return [
      { label: "Markets", value: String(linkrRows.length) },
      { label: "Stocks paid out", value: String(stockFacets.length) },
      { label: "Payouts published", value: String(linkrRows.reduce((s, r) => s + r.payouts, 0)) },
      { label: "Fees earned", value: formatUsd(fees, { compact: true }) },
    ];
  }, [linkrRows, stockFacets]);

  const item = reduced
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.98 }, transition: { duration: 0.22, ease: [0.22, 0.72, 0.24, 1] as const } };

  return (
    <MotionSurface className={`lk-section gallery-section ${full ? "gallery-full" : ""}`} id="markets">
      <div className="section-heading">
        <div>
          <span className="eyebrow">01 / CONNECTED MARKETS</span>
          <h2>Find your <em>point of view.</em></h2>
        </div>
        {full && linkrRows.length > 0 ? (
          <dl className="mk-summary">
            {summary.map((s) => <div key={s.label}><dt>{s.label}</dt><dd className="num">{s.value}</dd></div>)}
          </dl>
        ) : (
          <p>A coin with a story.<br />A basket with a purpose.</p>
        )}
      </div>

      <div className="mk-toolbar">
        <div className="segmented" role="group" aria-label="Which markets">
          <button aria-pressed={isLinkr} onClick={() => setTab("linkr")}>LINKR rewards{linkrRows.length > 0 && <small>{linkrRows.length}</small>}</button>
          <button aria-pressed={!isLinkr} onClick={() => setTab("all")}>All StonkFun</button>
        </div>
        {full ? (
          <>
            <label className="mk-search">
              <MagnifyingGlass size={15} aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search markets" placeholder={isLinkr ? "Search coins, stocks or pairs" : "Search coins or pairs"} />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={13} /></button>}
            </label>
            {isLinkr ? <SortSelect value={linkrSort} options={LINKR_SORTS} onChange={setLinkrSort} /> : <SortSelect value={feedSort} options={FEED_SORTS} onChange={setFeedSort} />}
          </>
        ) : (
          <Link href="/vaults" className="text-action">All markets <ArrowUpRight size={16} /></Link>
        )}
      </div>

      {full && isLinkr && stockFacets.length > 0 && (
        <div className="mk-filters">
          <div className="mk-filter-row" role="group" aria-label="Filter by stock">
            <span className="mk-filter-label">Pays in</span>
            <div className="mk-chips">
              {stockFacets.map((s) => (
                <Chip key={s.symbol} on={stocks.includes(s.symbol)} count={s.count} onClick={() => setStocks((p) => (p.includes(s.symbol) ? p.filter((x) => x !== s.symbol) : [...p, s.symbol]))}>
                  <TokenIcon symbol={s.symbol} address={s.mint} logoUrl={s.logoUrl} size={16} />
                  {s.symbol}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mk-filter-pair">
            {pairFacets.length > 1 && (
              <div className="mk-filter-row" role="group" aria-label="Filter by pair">
                <span className="mk-filter-label">Pair</span>
                <div className="mk-chips">
                  {pairFacets.map((p) => (
                    <Chip key={p.symbol} on={pair === p.symbol} count={p.count} onClick={() => setPair(pair === p.symbol ? null : p.symbol)}>
                      <TokenIcon symbol={p.symbol} address={p.mint} logoUrl={p.logoUrl} size={16} />
                      {p.symbol}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {periodFacets.length > 1 && (
              <div className="mk-filter-row" role="group" aria-label="Filter by payout period">
                <span className="mk-filter-label">Pays out</span>
                <div className="mk-chips">
                  {periodFacets.map(([s, count]) => (
                    <Chip key={s} on={period === s} count={count} onClick={() => setPeriod(period === s ? null : s)}>{periodLabel(s)}</Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {full && !isLinkr && kindFacets.length > 0 && (
        <div className="mk-filters">
          <div className="mk-filter-row" role="group" aria-label="Filter by pair type">
            <span className="mk-filter-label">Pair</span>
            <div className="mk-chips">
              {kindFacets.map(([k, count]) => (
                <Chip key={k} on={pairKind === k} count={count} onClick={() => setPairKind(pairKind === k ? null : k)}>{PAIR_KINDS[k]}</Chip>
              ))}
              <Chip on={stockOnly} onClick={() => setStockOnly((v) => !v)}>Pays in stocks</Chip>
            </div>
          </div>
        </div>
      )}

      {full && !loading && total > 0 && (
        <div className="mk-results" aria-live="polite">
          <span>{filtered ? `${list.length} of ${total} markets` : `${total} market${total === 1 ? "" : "s"}`}</span>
          {filtered && <button type="button" className="text-action" onClick={clear}>Clear filters <X size={13} /></button>}
        </div>
      )}

      {loading ? (
        <div className="market-grid mk-grid">{[0, 1, 2, 3].map((i) => <div className="skeleton mk-skeleton" key={i} />)}</div>
      ) : list.length ? (
        <>
          <motion.div className="market-grid mk-grid" layout={!reduced}>
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((r) => (
                <motion.div key={`${r.kind}-${r.id}`} layout={!reduced} {...item}>
                  {r.kind === "linkr" ? <LinkrTile row={r} now={now} /> : <FeedTile row={r} />}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
          {!full && (
            <div className="rail-controls">
              <span>Choose an idea. Follow the connection.</span>
              {list.length > shown.length && <Link href="/vaults" className="text-action">View all {list.length} markets <ArrowRight size={15} /></Link>}
            </div>
          )}
        </>
      ) : (
        <StateMessage
          title={failed ? "Markets are taking a moment." : filtered ? "No markets match these filters." : "The next connection starts here."}
          body={failed ? "The market service is unavailable. News and the rest of LINKR remain available." : filtered ? "Try another stock or pair, or clear the filters." : isLinkr ? "Active LINKR markets will appear here after their vaults are connected." : "No markets match this view."}
          retry={failed ? () => { if (isLinkr) void vaults.refetch(); else void feed.refetch(); } : undefined}
          action={filtered && !failed ? <button type="button" onClick={clear} className="text-action">Clear filters <X size={13} /></button> : undefined}
        />
      )}
      {!isLinkr && <p className="data-note">StonkFun discovery. Stock rewards apply only to markets marked “Pays holders in stocks”.</p>}
      {feed.data?.stale && !isLinkr && <p className="data-note">Showing the last available market snapshot.</p>}
    </MotionSurface>
  );
}
