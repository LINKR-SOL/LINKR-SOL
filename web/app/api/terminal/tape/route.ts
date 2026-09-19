import { getLiveMarkets, getTrades } from "@/lib/stonkfun/live";
import { json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const WATCH = 6; // markets to pull trades from per refresh
const PROBE = 18; // busiest coins considered when picking them

/**
 * A merged trade tape across the busiest StonkFun coins, from whatever streams trades into the `trades` collection.
 * `watched` states how many markets this covers, so the tape never implies it is showing the whole network.
 */
export async function GET(req: Request) {
  const limit = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 24)));

  const discovered = await getLiveMarkets(PROBE, WATCH);
  const coins = discovered.data ?? [];
  if (coins.length === 0) {
    return json({ trades: [], watched: 0, stale: discovered.stale, error: discovered.error, fetchedAt: discovered.fetchedAt });
  }

  const results = await Promise.all(coins.map((l) => getTrades(l.mint)));
  // Cap each market's contribution so one busy coin never crowds the others out.
  const perCoin = Math.max(3, Math.ceil(limit / coins.length) + 1);
  const trades = results
    .flatMap((envelope, i) => {
      const coin = coins[i];
      return (envelope.data ?? []).slice(0, perCoin).map((t) => ({
        side: t.side,
        timestamp: t.timestamp,
        signature: t.signature,
        trader: t.trader,
        valueUsd: t.valueUsd,
        priceUsd: t.priceUsd,
        mint: coin.mint,
        symbol: coin.symbol,
        name: coin.name,
        logo: coin.logo,
        quoteSymbol: coin.quote.symbol,
        quoteKind: coin.quote.kind,
        causaVaulted: coin.causaVaulted,
      }));
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return json(
    { trades, watched: coins.length, stale: discovered.stale || results.some((r) => r.stale), error: discovered.error, fetchedAt: Date.now() },
    { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" } },
  );
}
