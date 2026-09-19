import { NextResponse } from "next/server";
import { HERO_TOKEN, parseHeroCandles, type HeroHistory } from "@/lib/xstocks/hero-history";

const API = "https://api.geckoterminal.com/api/v2/networks/solana";
let cached: HeroHistory | null = null;
let pending: Promise<HeroHistory> | null = null;
let lastAttempt = 0;
const TTL = 5 * 60_000;
async function read(path: string) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(9000), cache: "no-store", headers: { accept: "application/json", "user-agent": "LINKR/hero" } });
  if (!response.ok) throw new Error(`Market history provider returned ${response.status}`);
  return response.json();
}
async function load(): Promise<HeroHistory> {
  const pools = await read(`/tokens/${HERO_TOKEN}/pools?page=1`);
  // Only chart pools where the verified NVDAx mint is the base asset.
  const pool = pools.data?.find((item: { attributes?: { address?: string }; relationships?: { base_token?: { data?: { id?: string } } } }) => item.relationships?.base_token?.data?.id === `solana_${HERO_TOKEN}` && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.attributes?.address ?? ""));
  if (!pool) throw new Error("No verified NVDAx pool is available");
  const address = pool.attributes.address;
  const history = await read(`/pools/${address}/ohlcv/day?aggregate=1&limit=16&currency=usd&token=base`);
  if (history.meta?.base?.address !== HERO_TOKEN) throw new Error("Market history token mismatch");
  const candles = parseHeroCandles(history.data?.attributes?.ohlcv_list);
  if (candles.length < 2) throw new Error("Not enough verified daily observations");
  return { candles, fetchedAt: Date.now(), stale: (Date.now() / 1000 - candles.at(-1)!.t) > 3 * 86400, sourceUrl: `https://www.geckoterminal.com/solana/pools/${address}`, error: null };
}
export async function GET() {
  if (cached && !cached.error && Date.now() - lastAttempt < TTL) return NextResponse.json(cached);
  pending ??= (async () => {
    lastAttempt = Date.now();
    try { cached = await load(); }
    catch (error) {
      cached = { candles: cached?.candles ?? [], fetchedAt: cached?.fetchedAt ?? 0, sourceUrl: cached?.sourceUrl ?? "https://www.geckoterminal.com/", stale: true, error: error instanceof Error ? error.message : "History unavailable" };
    }
    return cached;
  })().finally(() => { pending = null; });
  return NextResponse.json(await pending);
}
