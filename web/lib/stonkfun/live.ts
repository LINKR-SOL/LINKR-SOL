/**
 * Server-side reader for live StonkFun network data.
 *
 * Every figure the terminal shows comes through here. Three rules keep it honest:
 *  1. Nothing is invented — if the upstream is unreachable and we have no cache, the route returns
 *     `data: null` and the UI says so rather than rendering a zero.
 *  2. Responses are cached in module scope with a short TTL, and a stale copy is served (flagged `stale`)
 *     when a refresh fails, so a blip does not blank the page.
 *  3. Requests are deduplicated: concurrent callers for the same key share one fetch.
 *
 * Sources: StonkFun's public API for the catalogue, launch ledger and network totals, and our own vault index
 * to mark the coins whose holders are paid in stocks. StonkFun publishes no trade stream, so per-trade rows
 * come from the `trades` collection when something fills it and are otherwise empty — never faked.
 */
import { collections } from "../db/collections";
import { activeCluster } from "../solana/cluster";
import type { LaunchDoc } from "../db/types";
import { absoluteUrl, fetchStats, fetchToken, fetchTokens, type StonkQuote, type StonkToken, type TokenSort } from "./client";
import type { Feed, FeedLaunch, LiveEnvelope, Market, Pulse, QuoteAsset, Trade } from "./types";

/** StonkFun lives on mainnet; the feed is mainnet data whatever cluster the vaults run on. */
export const FEED_CLUSTER = "mainnet-beta";

export type FeedSort = "recentBuys" | "marketCap" | "newest" | "graduating" | "graduated";

// ---------------------------------------------------------------------------------------------
// quote assets
// ---------------------------------------------------------------------------------------------

const WSOL = "So11111111111111111111111111111111111111112";
const SOL_QUOTE: QuoteAsset = { mint: WSOL, symbol: "SOL", name: "Solana", kind: "solana", logoUrl: "/solana.svg" };

export function resolveQuote(q: StonkQuote | null | undefined): QuoteAsset {
  if (!q) return SOL_QUOTE;
  if (q.mint === WSOL) return SOL_QUOTE;
  return { mint: q.mint, symbol: q.symbol, name: q.name, kind: q.category || "unknown", logoUrl: absoluteUrl(q.logoUrl) };
}

// ---------------------------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------------------------

interface Entry<T> {
  value: T;
  fetchedAt: number;
}
const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function live<T>(key: string, ttlMs: number, source: string, fetcher: () => Promise<T>): Promise<LiveEnvelope<T>> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return { data: hit.value, fetchedAt: hit.fetchedAt, stale: false, error: null, source };
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fetcher().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    const value = await p;
    const fetchedAt = Date.now();
    cache.set(key, { value, fetchedAt });
    return { data: value, fetchedAt, stale: false, error: null, source };
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 160);
    if (hit) return { data: hit.value, fetchedAt: hit.fetchedAt, stale: true, error: message, source };
    return { data: null, fetchedAt: Date.now(), stale: false, error: message, source };
  }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

interface VaultIndex {
  /** vault address -> bound mint */
  byAddress: Map<string, string | null>;
  /** bound mint -> vault address */
  byMint: Map<string, string>;
}
let vaultIndex: { at: number; index: VaultIndex } | null = null;

/** Every LINKR vault on the active cluster, both ways round (30 s cache). */
async function vaults(): Promise<VaultIndex> {
  if (vaultIndex && Date.now() - vaultIndex.at < 30_000) return vaultIndex.index;
  const c = await collections();
  const docs = await c.vaults.find({ cluster: activeCluster }, { projection: { address: 1, launchMint: 1 } }).toArray();
  const index: VaultIndex = { byAddress: new Map(docs.map((v) => [v.address, v.launchMint ?? null])), byMint: new Map() };
  for (const v of docs) if (v.launchMint) index.byMint.set(v.launchMint, v.address);
  vaultIndex = { at: Date.now(), index };
  return index;
}

function fromToken(t: StonkToken, vi: VaultIndex, creator = ""): FeedLaunch {
  const vault = vi.byMint.get(t.mint) ?? (creator && vi.byAddress.has(creator) ? creator : null);
  const graduated = t.status === "graduated";
  return {
    mint: t.mint,
    bondingCurve: t.pool,
    pool: graduated ? t.pool : null,
    creator,
    deployer: null,
    name: t.name,
    symbol: t.symbol,
    logo: absoluteUrl(t.imageUrl),
    description: null,
    launchedAt: t.createdAt,
    quote: resolveQuote(t.quote),
    mode: t.mode,
    priceUsd: t.market?.priceUsd ?? null,
    marketCapUsd: t.market?.marketCapUsd ?? null,
    marketCapSol: null,
    liquidityUsd: t.market?.liquidityUsd ?? null,
    volume24hUsd: t.market?.volume24hUsd ?? null,
    graduated,
    graduationProgressPct: graduated ? 100 : Math.max(0, Math.min(100, Math.round((t.graduationProgress ?? 0) * 1000) / 10)),
    causaVaulted: vault !== null,
    vault,
    latestTradeAt: null,
  };
}

function fromDoc(l: LaunchDoc, vi: VaultIndex): FeedLaunch {
  const vault = vi.byAddress.has(l.creator) ? l.creator : (vi.byMint.get(l.mint) ?? null);
  return {
    mint: l.mint,
    bondingCurve: l.bondingCurve,
    pool: l.pool,
    creator: l.creator,
    deployer: l.deployer,
    name: l.name,
    symbol: l.symbol,
    logo: l.logo,
    description: l.description,
    launchedAt: l.launchedAt.toISOString(),
    quote: l.quoteMint && l.quoteMint !== WSOL ? { mint: l.quoteMint, symbol: `${l.quoteMint.slice(0, 4)}…`, name: "Quote token", kind: "unknown", logoUrl: null } : SOL_QUOTE,
    mode: "standard",
    priceUsd: null,
    marketCapUsd: null,
    marketCapSol: l.marketCapSol ? Number(l.marketCapSol) : null,
    liquidityUsd: null,
    volume24hUsd: null,
    graduated: l.complete,
    graduationProgressPct: l.complete ? 100 : 0,
    causaVaulted: vault !== null,
    vault,
    latestTradeAt: null,
  };
}

const API_SORT: Record<FeedSort, TokenSort> = {
  recentBuys: "volume24h",
  marketCap: "marketCap",
  newest: "newest",
  graduating: "marketCap",
  graduated: "marketCap",
};

// ---------------------------------------------------------------------------------------------
// readers
// ---------------------------------------------------------------------------------------------

/** The launch feed: StonkFun's catalogue in the requested order, with every CAUSA-vaulted coin folded in. */
export function getFeed(sort: FeedSort, limit = 60): Promise<LiveEnvelope<Feed>> {
  return live(`feed:${sort}`, 20_000, "stonkfun", async () => {
    const [coins, vi] = await Promise.all([
      fetchTokens({ sort: API_SORT[sort], limit: 100, status: sort === "graduated" ? "graduated" : sort === "graduating" ? "new" : undefined }),
      vaults(),
    ]);
    let launches = coins.map((t) => fromToken(t, vi));
    if (sort === "graduating") launches = launches.filter((l) => !l.graduated).sort((a, b) => b.graduationProgressPct - a.graduationProgressPct);
    if (sort === "graduated") launches = launches.filter((l) => l.graduated);
    // our own coins are few and may be too small to make StonkFun's top 100: always include them
    const c = await collections();
    const ours = await c.launches.find({ cluster: activeCluster, creator: { $in: [...vi.byAddress.keys()] } }).sort({ launchedAt: -1 }).limit(50).toArray();
    const seen = new Set(launches.map((l) => l.mint));
    for (const l of ours) if (!seen.has(l.mint)) launches.push(fromDoc(l, vi));
    const stats = await fetchStats().catch(() => null);
    return {
      launches: launches.slice(0, Math.max(limit, 60)),
      activeTotal: stats ? stats.tokens.total - stats.tokens.graduated : launches.filter((l) => !l.graduated).length,
      graduatedTotal: stats?.tokens.graduated ?? launches.filter((l) => l.graduated).length,
      launchTotal: stats?.tokens.total ?? (await c.launches.countDocuments({ cluster: FEED_CLUSTER })),
      generatedAt: Date.now(),
    };
  });
}

export async function getGraduations(): Promise<LiveEnvelope<FeedLaunch[]>> {
  const feed = await getFeed("graduated", 100);
  return { ...feed, data: feed.data?.launches ?? null };
}

/**
 * Network pulse: StonkFun's own totals, plus the last day of its launch ledger by the hour — as ingested by the
 * catalogue cron, since the ledger only pages 25 rows at a time. A fresh deployment shows what it has seen so far.
 */
export function getPulse(): Promise<LiveEnvelope<Pulse>> {
  return live("pulse", 60_000, "stonkfun", async () => {
    const c = await collections();
    const since = new Date(Date.now() - 24 * 3600_000);
    const [stats, created, vaultDocs] = await Promise.all([
      fetchStats(),
      c.launches.find({ cluster: FEED_CLUSTER, source: "stonkfun", launchedAt: { $gte: since } }, { projection: { launchedAt: 1 } }).toArray(),
      c.vaults.find({ cluster: activeCluster }, { projection: { status: 1 } }).toArray(),
    ]);
    const hourly = new Map<number, { launches: number }>();
    const hour = (ms: number) => Math.floor(ms / 3600_000) * 3600;
    for (let h = hour(since.getTime()); h <= hour(Date.now()); h += 3600) hourly.set(h, { launches: 0 });
    for (const l of created) {
      const b = hourly.get(hour(l.launchedAt.getTime()));
      if (b) b.launches++;
    }
    return {
      generatedAt: Date.now(),
      source: "stonkfun",
      totals: {
        launches24h: created.length,
        launchesSeen: stats.tokens.total,
        trades24h: null,
        volumeSol24h: null,
        volumeUsd24h: Math.round(stats.tokens.totalVolume24hUsd),
        causaVaults: vaultDocs.length,
        causaLaunches: vaultDocs.filter((v) => v.status === "active").length,
      },
      series: [...hourly].sort((a, b) => a[0] - b[0]).map(([timestamp, v]) => ({ timestamp, launches: v.launches, volumeSol: null })),
    };
  });
}

/** Recent trades of one coin (from the trades collection), newest first. Empty unless something streams them in. */
export function getTrades(mint: string, limit = 50): Promise<LiveEnvelope<Trade[]>> {
  return live(`trades:${mint}`, 10_000, "indexer", async () => {
    const c = await collections();
    const docs = await c.trades.find({ mint }).sort({ timestamp: -1 }).limit(limit).toArray();
    return docs.map((t) => ({
      side: t.side,
      timestamp: Math.floor(t.timestamp.getTime() / 1000),
      signature: t._id,
      trader: t.trader,
      tokenAmount: t.tokenAmount,
      solAmount: t.solAmount,
      valueUsd: null,
      priceUsd: null,
    }));
  });
}

/** The coins with the most volume over the last day — the ones worth a tape row. */
export function getLiveMarkets(probe = 18, watch = 6): Promise<LiveEnvelope<FeedLaunch[]>> {
  return live(`markets:${probe}:${watch}`, 30_000, "stonkfun", async () => {
    const [coins, vi] = await Promise.all([fetchTokens({ sort: "volume24h", limit: probe }), vaults()]);
    return coins.slice(0, watch).map((t) => fromToken(t, vi));
  });
}

export function getMarket(mint: string): Promise<LiveEnvelope<Market>> {
  return live(`market:${mint}`, 15_000, "stonkfun", async () => {
    const [coin, trades] = await Promise.all([fetchToken(mint), getTrades(mint, 100)]);
    const list = trades.data ?? [];
    const points = [...list].reverse().filter((t) => t.priceUsd !== null).map((t) => ({ t: t.timestamp, priceUsd: t.priceUsd as number }));
    const graduated = coin.status === "graduated";
    return {
      mint,
      bondingCurve: coin.pool,
      pool: graduated ? coin.pool : null,
      priceUsd: coin.market?.priceUsd ?? null,
      marketCapUsd: coin.market?.marketCapUsd ?? null,
      marketCapSol: null,
      liquidityUsd: coin.market?.liquidityUsd ?? null,
      volume24hUsd: coin.market?.volume24hUsd ?? null,
      changePct: coin.market?.priceChange24h ?? null,
      graduated,
      graduationProgressPct: graduated ? 100 : Math.round((coin.graduationProgress ?? 0) * 1000) / 10,
      trades: list,
      points,
    };
  });
}
