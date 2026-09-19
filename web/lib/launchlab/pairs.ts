import { envText, isMainnet } from "../solana/cluster";
import { STONKFUN_API, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT } from "./ids";

/**
 * The quote tokens a coin can be launched against. On mainnet this is StonkFun's live list — xStocks, PreStocks,
 * Sunrise, currencies, leverage, collectibles, SOL and hundreds of custom tokens — filtered to the ones that are
 * launchable right now and carry a LaunchLab config on chain. Devnet has LaunchLab configs for SOL and a mock
 * USDC only, so that is the list there.
 */
export interface QuotePair {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
  logoUrl: string | null;
  /** StonkFun's category key, e.g. xstock, prestock, backpack, currency, leverage, collectible, solana, custom */
  category: string;
  /** Tab label, e.g. "xStock", "Sunrise" */
  categoryLabel: string;
}

interface StonkPair {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  category: string;
  categoryLabel: string;
  tokenProgram: string;
  launchable: boolean;
  symbolAmbiguous?: boolean;
  launchLabReady: boolean;
}

export const SOL_PAIR: QuotePair = {
  mint: WSOL_MINT.toBase58(),
  symbol: "SOL",
  name: "Solana",
  decimals: 9,
  tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
  logoUrl: "/solana.svg",
  category: "solana",
  categoryLabel: "Solana",
};

/** Raydium's devnet USDC: a classic SPL mint with a LaunchLab config, so token-quoted launches can be tested too. */
export const DEVNET_USDC_PAIR: QuotePair = {
  mint: "USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT",
  symbol: "USDC",
  name: "USD Coin (devnet)",
  decimals: 6,
  tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
  logoUrl: null,
  category: "currency",
  categoryLabel: "Currency",
};

let cache: { at: number; pairs: QuotePair[] } | null = null;
const TTL = 60_000;

export async function launchablePairs(): Promise<QuotePair[]> {
  if (!isMainnet) return [SOL_PAIR, DEVNET_USDC_PAIR];
  if (cache && Date.now() - cache.at < TTL) return cache.pairs;
  const res = await fetch(`${STONKFUN_API}/pairs?launchable=true&launchLabReady=true`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) {
    if (cache) return cache.pairs;
    throw new Error(`stonkfun pairs ${res.status}`);
  }
  const body = (await res.json()) as { data?: { pairs?: StonkPair[] } };
  const pairs = (body.data?.pairs ?? [])
    .filter((p) => p.launchable && p.launchLabReady)
    .map<QuotePair>((p) => ({
      mint: p.mint,
      symbol: p.symbol,
      name: p.name,
      decimals: p.decimals,
      tokenProgram: p.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() ? p.tokenProgram : TOKEN_PROGRAM_ID.toBase58(),
      logoUrl: p.logoUrl ? (p.logoUrl.startsWith("/") ? `${envText(process.env.STONKFUN_API_ORIGIN) ?? "https://www.stonkfun.xyz"}${p.logoUrl}` : p.logoUrl) : null,
      category: p.category,
      categoryLabel: p.categoryLabel,
    }));
  // SOL first, then stocks: the order the picker shows tabs in
  pairs.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
  cache = { at: Date.now(), pairs };
  return pairs;
}

const ORDER = ["solana", "xstock", "prestock", "backpack", "currency", "leverage", "collectible", "custom"];
const rank = (p: QuotePair) => {
  const i = ORDER.indexOf(p.category);
  return i === -1 ? ORDER.length : i;
};

export async function findPair(mint: string): Promise<QuotePair | null> {
  const pairs = await launchablePairs();
  return pairs.find((p) => p.mint === mint) ?? null;
}
