/**
 * Stocktwits news API — SOURCE_INVENTORY.md §3.4.
 *
 * The best-shaped source in the inventory for this site: every article arrives already
 * tagged with the symbols it is about, which is exactly the linkage the newswire needs.
 * Called anonymously with the origin/referer pair a normal page load sends; no cookie or
 * login is involved. The inventory records that a cold server can see HTTP 403 here, so
 * a failure is recorded as source health and produces nothing rather than throwing.
 */
import { requestJsonRetry } from "../http";
import { hostOf } from "../http";
import { envList, envNumber, type Adapter, type RawStory } from "./types";

const ENDPOINT = "https://api-gw-prd.stocktwits.com/news/v2/articles";
const REFERER = "https://stocktwits.com/";

/**
 * The inventory's default symbol set is the bot's; this one is the site's. Every name here
 * is an xStock on Solana and a member of a narrative basket, so a story that comes
 * back tagged with one of them already carries the linkage the wire needs. 25 is the
 * documented ceiling on repeated `symbols` parameters.
 */
const DEFAULT_SYMBOLS = [
  "SPY", "NVDA", "AVGO", "SMCI", "TSM", "ASML", "MU", "AMD", "TSLA", "AAPL", "MSFT", "GOOGL",
  "AMZN", "META", "COIN", "MSTR", "CRCL", "OKLO", "GME", "AMC", "RDDT", "PLTR", "IONQ", "RKLB", "CEG",
];

interface Article {
  url_slug?: string;
  headline?: string;
  title?: string;
  summary?: string;
  meta_description?: string;
  content?: string;
  canonical_url?: string;
  url?: string;
  created_at?: string;
  updated_at?: string;
  image_url?: string;
  featured_image?: string | { url?: string };
  author?: string;
  source?: string | { name?: string; source_name?: string; url_domain?: string };
  category?: { name?: string };
  tags?: { tag_name?: string }[];
  symbol_codes?: string[];
  symbols?: ({ symbol?: string } | string)[];
}

function imageOf(a: Article): string | null {
  if (typeof a.image_url === "string" && a.image_url) return a.image_url;
  if (typeof a.featured_image === "string") return a.featured_image || null;
  if (a.featured_image && typeof a.featured_image === "object") return a.featured_image.url ?? null;
  return null;
}

function symbolsOf(a: Article): string[] {
  const codes = a.symbol_codes ?? [];
  const objs = (a.symbols ?? []).map((s) => (typeof s === "string" ? s : (s.symbol ?? ""))).filter(Boolean);
  return [...new Set([...codes, ...objs])];
}

export const stocktwits: Adapter = {
  key: "stocktwits",
  label: "Stocktwits",
  envFlag: "SOURCE_STOCKTWITS",
  defaultOn: true,
  async collect() {
    const symbols = envList("STOCKTWITS_SYMBOLS", DEFAULT_SYMBOLS).slice(0, 25);
    const limit = envNumber("STOCKTWITS_NEWS_LIMIT", 30, 3, 30);

    const params = new URLSearchParams({ collapse: "true", sorted_news_count: String(limit) });

    // The inventory defaults source_id to 1071. That id is Stocktwits' own newsroom, and
    // measured against the live endpoint it publishes slowly enough that nothing it returns
    // is inside a 48-hour window. Omitting the parameter returns the full syndicated wire —
    // Nasdaq, Zacks, Benzinga, Yahoo — where every item came back under four hours old.
    // Set STOCKTWITS_NEWS_SOURCE_ID=1071 to go back to Stocktwits-only reporting.
    const sourceId = process.env.STOCKTWITS_NEWS_SOURCE_ID?.trim();
    if (sourceId) params.set("source_id", sourceId);
    for (const s of symbols) params.append("symbols", s);

    // The capture in feeds-backend-explanation/ shows a bare array; the wrapped forms are
    // kept as a fallback in case the gateway ever envelopes it.
    const body = await requestJsonRetry<Article[] | { articles?: Article[]; items?: Article[]; data?: Article[] }>(
      `${ENDPOINT}?${params}`,
      { referer: REFERER },
    );
    const articles = Array.isArray(body) ? body : (body.articles ?? body.items ?? body.data ?? []);

    const out: RawStory[] = [];
    for (const a of articles) {
      const title = (a.headline ?? a.title ?? "").trim();
      // canonical_url comes back empty for Stocktwits' own reporting; their public article
      // path is the slug. Override with STOCKTWITS_ARTICLE_BASE if that ever moves.
      const base = process.env.STOCKTWITS_ARTICLE_BASE?.trim() || "https://stocktwits.com/news-articles";
      const url = a.canonical_url?.trim() || a.url?.trim() || (a.url_slug ? `${base}/${a.url_slug}` : null);
      const published = a.created_at ?? a.updated_at;
      if (!title || !published) continue;
      const at = new Date(published);
      if (!Number.isFinite(at.getTime())) continue;

      const source = typeof a.source === "string" ? a.source : (a.source?.source_name ?? a.source?.name);

      out.push({
        sourceKey: "stocktwits",
        sourceName: source?.trim() || hostOf(url) || "Stocktwits",
        lane: "market",
        tier: 2,
        title,
        summary: (a.summary ?? a.meta_description ?? a.content ?? "").trim().slice(0, 400) || null,
        url,
        imageUrl: imageOf(a),
        publishedAt: at,
        symbolHints: symbolsOf(a),
      });
    }
    return out;
  },
};
