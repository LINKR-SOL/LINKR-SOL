/**
 * The xStocks registry (Backed Finance's public asset API): every tokenised stock/ETF with its Solana mint.
 * Cached in module scope with a long TTL; `lib/stock-tokens.generated.ts` is a build-time snapshot of the same
 * data for places that must not depend on the network (the asset picker, the newswire linkage).
 */

export interface XStock {
  mint: string;
  symbol: string; // underlying ticker, e.g. NVDA
  xSymbol: string; // NVDAx
  name: string;
  isin: string;
  underlyingIsin: string | null;
  logoUrl: string | null;
  tradingHalted: boolean;
}

const API = "https://api.backed.fi/api/v2/public/assets";
const TTL_MS = 6 * 60 * 60_000;

interface BackedAsset {
  name: string;
  symbol: string;
  isin: string;
  underlyingSymbol: string | null;
  underlyingIsin: string | null;
  logo: string | null;
  isTradingHalted: boolean;
  deployments: { address: string; network: string }[];
}

let cache: { at: number; list: XStock[] } | null = null;

export async function fetchXStocks(): Promise<XStock[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  const out: XStock[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${API}?page=${page}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`backed assets ${res.status}`);
    const body = (await res.json()) as { nodes: BackedAsset[] };
    for (const a of body.nodes ?? []) {
      const sol = a.deployments?.find((d) => d.network === "Solana");
      if (!sol || !a.underlyingSymbol) continue;
      out.push({
        mint: sol.address,
        symbol: a.underlyingSymbol,
        xSymbol: a.symbol,
        name: a.name.replace(/\s*xStock$/i, ""),
        isin: a.isin,
        underlyingIsin: a.underlyingIsin,
        logoUrl: a.logo,
        tradingHalted: Boolean(a.isTradingHalted),
      });
    }
    if ((body.nodes ?? []).length < 100) break;
  }
  const dedup = [...new Map(out.map((x) => [x.mint, x])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  cache = { at: Date.now(), list: dedup };
  return dedup;
}
