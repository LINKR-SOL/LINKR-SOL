import { getPulse } from "@/lib/stonkfun/live";
import { getStockQuotes } from "@/lib/xstocks/quotes";
import { NARRATIVES, narrativeTokens } from "@/lib/narratives";
import { stockLogo } from "@/lib/marks";
import { json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * Everything the terminal header needs: StonkFun network totals, live xStock quotes, and
 * each narrative basket scored against those quotes.
 *
 * The dispersion figures are the argument for paying holders in a basket rather than one ticker,
 * so they are computed from live prices only — a basket with fewer than two priced members
 * reports `null` instead of a spread it cannot back up.
 */
export async function GET() {
  const [pulse, stocks] = await Promise.all([getPulse(), getStockQuotes()]);
  const byMint = new Map(stocks.quotes.map((q) => [q.mint, q]));

  const narratives = NARRATIVES.map((n) => {
    const tokens = narrativeTokens(n);
    const priced = tokens.map((t) => byMint.get(t.mint)).filter((q): q is NonNullable<typeof q> => Boolean(q) && q!.change24h !== null);
    const moves = priced.map((q) => ({ symbol: q.symbol, change24h: q.change24h as number }));
    moves.sort((a, b) => b.change24h - a.change24h);
    return {
      id: n.id,
      name: n.name,
      thesis: n.thesis,
      dispersion: n.dispersion,
      accent: n.accent,
      size: tokens.length,
      members: tokens.map((t) => {
        const q = byMint.get(t.mint);
        return {
          symbol: t.symbol,
          name: t.name,
          mint: t.mint,
          logoUrl: stockLogo(t.symbol, t.logoUrl),
          priceUsd: q?.priceUsd ?? null,
          change24h: q?.change24h ?? null,
          liquidityUsd: q?.liquidityUsd ?? null,
        };
      }),
      pricedCount: priced.length,
      best: moves[0] ?? null,
      worst: moves.length > 1 ? moves[moves.length - 1] : null,
      spreadPct: moves.length > 1 ? moves[0].change24h - moves[moves.length - 1].change24h : null,
      basketChange24h: moves.length ? moves.reduce((s, m) => s + m.change24h, 0) / moves.length : null,
    };
  });

  return json(
    { pulse, stocks: { quotes: stocks.quotes, fetchedAt: stocks.fetchedAt, stale: stocks.stale }, narratives },
    { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
