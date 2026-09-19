/**
 * Live quotes for xStocks on Solana.
 *
 * GeckoTerminal indexes the Raydium/Meteora pools where xStocks trade against USDC. One bulk lookup per
 * minute covers the stocks the narrative baskets name plus anything a page has asked about (vault baskets);
 * the token's top pool supplies the 24h move and liquidity. Symbols always come from our own registry keyed
 * by mint. A stock that resolves to no pool is omitted rather than shown at a made-up price.
 */
import { MAINNET_STOCK_TOKENS, STOCK_BY_MINT, STOCK_BY_SYMBOL } from "../stock-tokens.generated";
import { stockLogo } from "../marks";
import { NARRATIVE_SYMBOLS } from "../narratives";

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const BULK_CHUNK = 30; // GeckoTerminal's cap for /tokens/multi

export interface StockQuote {
  mint: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  priceUsd: number;
  change24h: number | null;
  volume24hUsd: number;
  liquidityUsd: number;
}

const NARRATIVE_MINTS = NARRATIVE_SYMBOLS.map((s) => STOCK_BY_SYMBOL.get(s)?.mint).filter((m): m is string => Boolean(m));

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface GtPool {
  id?: string;
  attributes: { price_change_percentage?: { h24?: string | null }; reserve_in_usd?: string | null };
}

interface GtToken {
  attributes: { address?: string; price_usd?: string | null; volume_usd?: { h24?: string | null }; image_url?: string | null };
  relationships?: { top_pools?: { data?: { id: string }[] } };
}

async function gtFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GT}${path}`, {
    signal: AbortSignal.timeout(9_000),
    cache: "no-store",
    // GeckoTerminal rejects requests that send no user agent.
    headers: { accept: "application/json", "user-agent": "LINKR/terminal" },
  });
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  return (await res.json()) as T;
}

async function fromBulk(mints: string[]): Promise<Map<string, StockQuote>> {
  const out = new Map<string, StockQuote>();
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += BULK_CHUNK) chunks.push(mints.slice(i, i + BULK_CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) =>
      gtFetch<{ data?: GtToken[]; included?: GtPool[] }>(`/tokens/multi/${chunk.join(",")}?include=top_pools`).catch(() => ({ data: [], included: [] })),
    ),
  );
  for (const result of results) {
    const pools = new Map((result.included ?? []).map((p) => [p.id ?? "", p]));
    for (const t of result.data ?? []) {
      const token = STOCK_BY_MINT.get(t.attributes.address ?? "");
      const priceUsd = num(t.attributes.price_usd);
      if (!token || !priceUsd) continue;
      const top = pools.get(t.relationships?.top_pools?.data?.[0]?.id ?? "");
      out.set(token.mint, {
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        logoUrl: stockLogo(token.symbol, token.logoUrl ?? t.attributes.image_url ?? null),
        priceUsd,
        change24h: num(top?.attributes.price_change_percentage?.h24),
        volume24hUsd: num(t.attributes.volume_usd?.h24) ?? 0,
        liquidityUsd: num(top?.attributes.reserve_in_usd) ?? 0,
      });
    }
  }
  return out;
}

let cache: { quotes: StockQuote[]; fetchedAt: number; version: number } | null = null;
let inflight: Promise<StockQuote[]> | null = null;
let lastAttempt = 0;
const TTL = 60_000;

/** Mints some page has asked about (vault baskets, mostly) ride along in the next bulk lookup. */
const interest = new Set<string>();
let version = 0;

export async function getPricesFor(mints: string[]): Promise<Map<string, number>> {
  for (const m of mints) {
    if (STOCK_BY_MINT.has(m) && !interest.has(m)) {
      interest.add(m);
      version++;
    }
  }
  const { quotes } = await getStockQuotes();
  return new Map(quotes.map((q) => [q.mint, q.priceUsd]));
}

async function load(): Promise<StockQuote[]> {
  const wanted = [...new Set([...NARRATIVE_MINTS, ...interest])];
  const bulk = await fromBulk(wanted);
  return [...bulk.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

/** Live quotes for every xStock we can currently price. */
export async function getStockQuotes(): Promise<{ quotes: StockQuote[]; fetchedAt: number; stale: boolean }> {
  if (MAINNET_STOCK_TOKENS.length === 0) return { quotes: [], fetchedAt: Date.now(), stale: false };
  const wanted = version;
  if (cache && Date.now() - cache.fetchedAt < TTL && cache.version === wanted) return { quotes: cache.quotes, fetchedAt: cache.fetchedAt, stale: false };
  // A newly named stock should not let every request re-ask: one attempt per TTL, cache or not.
  if (Date.now() - lastAttempt < TTL && cache) return { quotes: cache.quotes, fetchedAt: cache.fetchedAt, stale: true };
  lastAttempt = Date.now();
  inflight ??= load().finally(() => {
    inflight = null;
  });
  try {
    const quotes = await inflight;
    if (quotes.length === 0 && cache) return { quotes: cache.quotes, fetchedAt: cache.fetchedAt, stale: true };
    cache = { quotes, fetchedAt: Date.now(), version: wanted };
    return { quotes, fetchedAt: cache.fetchedAt, stale: false };
  } catch {
    if (cache) return { quotes: cache.quotes, fetchedAt: cache.fetchedAt, stale: true };
    return { quotes: [], fetchedAt: Date.now(), stale: true };
  }
}
