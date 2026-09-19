import { getNews } from "@/lib/news/source";
import type { NewsCategory } from "@/lib/news/types";
import { json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CATEGORIES: NewsCategory[] = ["markets", "stocks", "crypto", "chain", "protocol", "company"];

/** The newswire. Reads the collector's store; see lib/news/source.ts for the order of preference. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = url.searchParams.get("category");
  const category = requested && CATEGORIES.includes(requested as NewsCategory) ? (requested as NewsCategory) : "all";
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));
  const tickers = (url.searchParams.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim().replace(/^\$/, "").toUpperCase())
    .filter(Boolean);

  const envelope = await getNews({ category, limit, tickers, cursor: url.searchParams.get("cursor") });

  return json(
    { ...envelope, category },
    { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
