/**
 * Normalised shapes for the newswire.
 *
 * The rest of the app only ever sees these types, so wiring a real provider means
 * writing one `fetchFromProvider()` in lib/news/source.ts that returns `NewsItem[]` —
 * no component changes. Same honesty rule as the StonkFun terminal: a field that is not
 * known is `null`, never invented.
 */

/** Bucket a story belongs to. Kept short so the filter rail stays one line. */
export type NewsCategory = "markets" | "stocks" | "crypto" | "chain" | "protocol" | "company";

export const NEWS_CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: "markets", label: "Markets" },
  { id: "stocks", label: "Stocks" },
  { id: "crypto", label: "Crypto" },
  { id: "chain", label: "Solana" },
  { id: "protocol", label: "StonkFun" },
  { id: "company", label: "LINKR" },
];

export const CATEGORY_LABEL: Record<NewsCategory, string> = Object.fromEntries(
  NEWS_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<NewsCategory, string>;

export interface NewsSource {
  /** Display name of the outlet, e.g. "Reuters". */
  name: string;
  /** Bare hostname, used for the favicon fallback and the "read on" line. */
  domain: string | null;
}

export interface NewsItem {
  /** Stable id from the provider; used as the React key and the selection key. */
  id: string;
  title: string;
  /** One or two sentences. `null` when the provider gives none — the card then
   *  shows the headline alone rather than a padded-out excerpt. */
  summary: string | null;
  /** Canonical article URL. `null` for stories with nowhere to link out to. */
  url: string | null;
  imageUrl: string | null;
  source: NewsSource;
  /** ISO 8601. */
  publishedAt: string;
  category: NewsCategory;
  /** Tokenised-stock tickers the story is about — uppercase, no `$`. These are joined
   *  against live quotes, so only symbols that exist as xStocks on Solana will price. */
  tickers: string[];
  /** Narrative basket ids (see lib/narratives.ts) the story maps to, when the provider
   *  can classify it. Drives the "pair this thesis" panel. */
  narratives?: string[];
  /** Provider-supplied take on the story: what it means for the assets above.
   *  Rendered as the thesis panel's body when present. */
  insight?: string | null;
  /** Directional read, when the provider scores one. */
  sentiment?: "bullish" | "bearish" | "neutral" | null;
  /** Free-form labels shown as chips under the thesis (e.g. "Regulation"). */
  tags?: string[];
}

export interface NewsFeed {
  items: NewsItem[];
  /** Opaque cursor for the next page; `null` when the provider has no more. */
  nextCursor: string | null;
  /** Total matching stories, when the provider reports one. */
  total: number | null;
}

/** Same envelope shape the StonkFun terminal uses, so <LiveStatus /> works unchanged. */
export interface NewsEnvelope {
  data: NewsFeed | null;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
  source: string;
  /** false when no provider is wired up — surfaces are hidden rather than shown empty. */
  configured: boolean;
  /** true when the payload is the built-in design sample, not real reporting. */
  preview: boolean;
}

/**
 * Drops a summary that only restates the headline.
 *
 * Aggregated feeds routinely set the description to `"<title> <source name>"`, which renders as a
 * paragraph directly under the headline saying exactly the same thing. Compared on letters and digits
 * alone, so punctuation, casing and the trailing attribution do not hide the repetition. Applied on
 * read as well as on ingest, so stories already in the store are cleaned up too.
 */
export function usefulSummary(summary: string | null | undefined, title: string): string | null {
  if (!summary) return null;
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = key(title);
  const s = key(summary);
  if (!t || !s) return summary;
  if (s === t) return null;
  // Whatever follows the headline is usually just the publication: too short to be a summary.
  if (s.startsWith(t) && s.length - t.length < 40) return null;
  return summary;
}
