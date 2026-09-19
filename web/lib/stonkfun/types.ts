/**
 * Normalised shapes for live StonkFun network data.
 *
 * The feed is assembled server-side from StonkFun's public API and our own indexer, and served from
 * /api/terminal/*, so the browser never talks to a third party and every number on the page is traceable to a
 * real launch, trade or transaction.
 */

/** What a coin is priced in: SOL, a stablecoin, an xStock, a pre-IPO token, a meme… (StonkFun's category key). */
export interface QuoteAsset {
  mint: string;
  symbol: string;
  name: string;
  /** solana, currency, xstock, prestock, backpack (Sunrise), leverage, collectible, custom, unknown */
  kind: string;
  logoUrl: string | null;
}

export interface FeedLaunch {
  mint: string;
  /** the LaunchLab pool while on the curve */
  bondingCurve: string;
  /** the Raydium pool once graduated */
  pool: string | null;
  /** the pool's `creator`; a LINKR vault for coins launched here (empty when the catalogue does not say) */
  creator: string;
  deployer: string | null;
  name: string;
  symbol: string;
  logo: string | null;
  description: string | null;
  launchedAt: string;
  quote: QuoteAsset;
  /** standard pays the creator; reward taxes transfers for holders instead */
  mode: "standard" | "reward";
  priceUsd: number | null;
  marketCapUsd: number | null;
  marketCapSol: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  graduated: boolean;
  /** 0–100 progress along the bonding curve toward graduation. */
  graduationProgressPct: number;
  /** true when the coin's creator is a LINKR vault (holders are paid in stocks). */
  causaVaulted: boolean;
  vault: string | null;
  latestTradeAt: string | null;
}

export interface Feed {
  launches: FeedLaunch[];
  activeTotal: number;
  graduatedTotal: number;
  launchTotal: number;
  generatedAt: number;
}

export interface Trade {
  side: "buy" | "sell";
  timestamp: number;
  signature: string;
  trader: string;
  tokenAmount: string;
  solAmount: string;
  valueUsd: number | null;
  priceUsd: number | null;
}

export interface Market {
  mint: string;
  bondingCurve: string;
  pool: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  marketCapSol: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  changePct: number | null;
  graduated: boolean;
  graduationProgressPct: number;
  trades: Trade[];
  points: { t: number; priceUsd: number }[];
}

export interface Pulse {
  generatedAt: number;
  source: string;
  totals: {
    launches24h: number;
    launchesSeen: number;
    /** null: StonkFun's API publishes volume, not trade counts */
    trades24h: number | null;
    volumeSol24h: number | null;
    volumeUsd24h: number | null;
    causaVaults: number;
    causaLaunches: number;
  };
  /** Hourly launches over the last day, oldest first (volume per hour is not published). */
  series: { timestamp: number; launches: number; volumeSol: number | null }[];
}

/** Wrapper every /api/terminal route returns, so the UI can always tell live data
 *  from a stale cache or an unreachable upstream instead of silently showing zeros. */
export interface LiveEnvelope<T> {
  data: T | null;
  /** ms since epoch the payload was assembled. */
  fetchedAt: number;
  /** true when this is a cached copy served because the upstream call failed. */
  stale: boolean;
  /** Set when there is no data at all. */
  error: string | null;
  source: string;
}
