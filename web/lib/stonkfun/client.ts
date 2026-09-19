import { STONKFUN_API, STONKFUN_ORIGIN } from "../launchlab/ids";

/**
 * StonkFun's public API (no key, 300 requests a minute per IP). The catalogue behind the launch feed and the
 * per-coin market page. Never used to send anything — launches and trades are built on chain by the app itself.
 * Docs: https://www.stonkfun.xyz/developers
 */

export interface StonkQuote {
  mint: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  category: string;
  categoryLabel: string;
}

export interface StonkToken {
  mint: string;
  /** the LaunchLab pool while on the curve; the Raydium pool once graduated */
  pool: string;
  name: string;
  symbol: string;
  quote: StonkQuote;
  /** "launchlab" for bonding-curve launches, "raydium" for the older direct-pool ones */
  launchpad: string;
  mode: "standard" | "reward";
  quoteOnlyFees?: boolean;
  transferFee?: { bps: number } | null;
  imageUrl: string | null;
  metadataUri?: string | null;
  links?: { website?: string; twitter?: string; telegram?: string };
  market: {
    priceUsd: number | null;
    marketCapUsd: number | null;
    fdvUsd?: number | null;
    volume24hUsd: number | null;
    liquidityUsd?: number | null;
    priceChange24h?: number | null;
    peakMarketCapUsd?: number | null;
  };
  status: "new" | "aboutToGraduate" | "graduated";
  /** 0–1 */
  graduationProgress: number;
  graduatedAt?: string | null;
  createdAt: string;
}

export interface StonkLaunchRow {
  mint: string;
  pool: string;
  name: string;
  symbol: string;
  creator: string;
  quote: { mint: string; symbol: string };
  launchpad: string;
  mode: "standard" | "reward";
  logoUrl: string | null;
  startMarketCapUsd: number | null;
  targetMarketCapUsd: number | null;
  createdAt: string;
}

export interface StonkStats {
  network: string;
  tokens: { poolsAvailable: boolean; total: number; graduated: number; aboutToGraduate: number; rewardLaunches: number; totalMarketCapUsd: number; totalVolume24hUsd: number };
  revenue: { totalRevenueUsd: number; totalBuybackUsd: number };
  burns: { totalValueUsdAtBurn: number; burnCount: number };
  config: { graduationMarketCapUsd: number; aboutToGraduateMarketCapUsd: number; launchLabEnabled: boolean; apiLaunchesEnabled: boolean };
}

async function get<T>(path: string, timeoutMs = 9_000): Promise<T> {
  const res = await fetch(`${STONKFUN_API}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`stonkfun api ${res.status} ${path.split("?")[0]}`);
  const body = (await res.json()) as { data?: T; error?: { message?: string } };
  if (!body.data) throw new Error(body.error?.message ?? `stonkfun api: empty ${path.split("?")[0]}`);
  return body.data;
}

/** StonkFun serves its own logos from relative paths. */
export const absoluteUrl = (u: string | null | undefined): string | null => (!u ? null : u.startsWith("/") ? `${STONKFUN_ORIGIN}${u}` : u);

export type TokenSort = "newest" | "marketCap" | "volume24h";

export async function fetchTokens(opts: { sort: TokenSort; status?: StonkToken["status"]; limit?: number; quote?: string }): Promise<StonkToken[]> {
  const q = new URLSearchParams({ sort: opts.sort, limit: String(Math.min(opts.limit ?? 50, 100)) });
  if (opts.status) q.set("status", opts.status);
  if (opts.quote) q.set("quote", opts.quote);
  const d = await get<{ tokens: StonkToken[] }>(`/tokens?${q}`);
  return d.tokens ?? [];
}

/** One coin's live record. The endpoint wraps it as `{ token, launch }`; the launch half is StonkFun's own ledger row. */
export const fetchToken = async (mint: string): Promise<StonkToken> => (await get<{ token: StonkToken }>(`/tokens/${mint}`)).token;

/** The launch ledger, newest first. Pages are 25 rows whatever `limit` says, so callers page explicitly. */
export async function fetchLaunches(page = 1): Promise<StonkLaunchRow[]> {
  const d = await get<{ launches: StonkLaunchRow[] }>(`/launches?limit=25&page=${page}`);
  return d.launches ?? [];
}

export const fetchStats = () => get<StonkStats>("/stats", 6_000);
