import { getFeed, type FeedSort } from "@/lib/stonkfun/live";
import { json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const SORTS: FeedSort[] = ["recentBuys", "marketCap", "newest", "graduating", "graduated"];

/**
 * The live launch feed, plus the number that motivates this whole product: how many of
 * the coins in view pay their holders in stocks rather than paying their creator in SOL.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = url.searchParams.get("sort") as FeedSort | null;
  const sort: FeedSort = requested && SORTS.includes(requested) ? requested : "recentBuys";
  const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));

  const envelope = await getFeed(sort, limit);
  const launches = envelope.data?.launches ?? [];

  // Breakdown of what the market is currently pricing coins in.
  const counts = new Map<string, { symbol: string; kind: string; count: number; logoUrl: string | null }>();
  for (const l of launches) {
    const key = l.quote.symbol;
    const entry = counts.get(key) ?? { symbol: key, kind: l.quote.kind, count: 0, logoUrl: l.quote.logoUrl };
    entry.count += 1;
    counts.set(key, entry);
  }
  const pairing = [...counts.values()].sort((a, b) => b.count - a.count);
  const causaVaulted = launches.filter((l) => l.causaVaulted).length;

  return json(
    {
      ...envelope,
      data: envelope.data && { ...envelope.data, launches: launches.slice(0, limit) },
      sort,
      pairing,
      causaVaulted,
      stockPaired: causaVaulted,
      sampled: launches.length,
    },
    { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" } },
  );
}
