/**
 * What /api/news serves.
 *
 * Three ways to get a wire, checked in order:
 *  1. NEWS_API_URL — an external provider, if you have one. Escape hatch; nothing else here runs.
 *  2. The built-in collector's Mongo collection. This is the normal path: /api/cron/news
 *     fills it, and a read that finds it stale kicks off a refresh without blocking.
 *  3. The design sample, in dev only, so the pages can be worked on with no backend.
 *
 * The honesty rule from lib/stonkfun/live.ts holds throughout: with nothing real to show, the
 * envelope says so and the surfaces render nothing rather than a placeholder story.
 */
import type { NewsCategory, NewsEnvelope, NewsFeed, NewsItem } from "./types";
import { usefulSummary } from "./types";
import { SAMPLE_NEWS } from "./sample";
import { listNews, newestPublishedAt } from "./store";
import { collectNews } from "./collect";
import { publicWire } from "./public-wire";

const API_URL = process.env.NEWS_API_URL?.trim() || "";
const API_KEY = process.env.NEWS_API_KEY?.trim() || "";

/** The built-in sample is on by default in dev and off everywhere else, so a production
 *  deploy without a wire shows no news rather than placeholder news. */
const PREVIEW = false;

const hasStore = () => Boolean(process.env.MONGODB_URI?.trim());

/** How stale the newest story may be before a read triggers a background collection. */
const staleMinutes = () => {
  const v = Number(process.env.NEWS_STALE_MINUTES);
  return Number.isFinite(v) && v > 0 ? v : 12;
};

export interface NewsQuery {
  category?: NewsCategory | "all";
  tickers?: string[];
  limit?: number;
  cursor?: string | null;
}

// ---------------------------------------------------------------------------------------------
// external provider (optional)
// ---------------------------------------------------------------------------------------------

const CATEGORIES = new Set<NewsCategory>(["markets", "stocks", "crypto", "chain", "protocol", "company"]);

async function fetchFromProvider(query: NewsQuery): Promise<NewsFeed> {
  const url = new URL(API_URL);
  if (query.category && query.category !== "all") url.searchParams.set("category", query.category);
  if (query.tickers?.length) url.searchParams.set("tickers", query.tickers.join(","));
  if (query.limit) url.searchParams.set("limit", String(query.limit));
  if (query.cursor) url.searchParams.set("cursor", query.cursor);

  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
    headers: { accept: "application/json", ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) },
  });
  if (!res.ok) throw new Error(`news ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { items?: unknown; nextCursor?: string | null; total?: number | null } | unknown[];
  const raw = Array.isArray(body) ? body : (body.items ?? []);
  if (!Array.isArray(raw)) throw new Error("news provider returned no items array");

  return {
    items: raw.map(normalise).filter((i): i is NewsItem => i !== null),
    nextCursor: (Array.isArray(body) ? null : (body.nextCursor ?? null)) as string | null,
    total: (Array.isArray(body) ? null : (body.total ?? null)) as number | null,
  };
}

/** Coerces one external record into a NewsItem, or drops it. Unknown fields become null
 *  rather than a default that would read as fact. */

function normalise(raw: unknown): NewsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;

  const publishedAt =
    typeof r.publishedAt === "string" ? r.publishedAt : typeof r.published_at === "string" ? r.published_at : null;
  const category = typeof r.category === "string" && CATEGORIES.has(r.category as NewsCategory) ? (r.category as NewsCategory) : "markets";
  const src = (r.source ?? {}) as Record<string, unknown>;
  const url = typeof r.url === "string" && /^https?:\/\//.test(r.url) ? r.url : null;

  return {
    id: String(r.id ?? url ?? title),
    title,
    summary: usefulSummary(typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : null, title),
    url,
    imageUrl: typeof r.imageUrl === "string" && /^https?:\/\//.test(r.imageUrl) ? r.imageUrl : null,
    source: {
      name: typeof src.name === "string" && src.name.trim() ? src.name.trim() : typeof r.source === "string" ? r.source : "Unattributed",
      domain: typeof src.domain === "string" ? src.domain : null,
    },
    publishedAt: publishedAt ?? new Date().toISOString(),
    category,
    tickers: Array.isArray(r.tickers)
      ? [...new Set(r.tickers.filter((t): t is string => typeof t === "string").map((t) => t.replace(/^\$/, "").toUpperCase()))]
      : [],
    narratives: Array.isArray(r.narratives) ? r.narratives.filter((n): n is string => typeof n === "string") : [],
    insight: typeof r.insight === "string" && r.insight.trim() ? r.insight.trim() : null,
    sentiment: r.sentiment === "bullish" || r.sentiment === "bearish" || r.sentiment === "neutral" ? r.sentiment : null,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

// ---------------------------------------------------------------------------------------------
// sample (dev only)
// ---------------------------------------------------------------------------------------------

function filterSample(query: NewsQuery): NewsFeed {
  let items = SAMPLE_NEWS;
  if (query.category && query.category !== "all") items = items.filter((i) => i.category === query.category);
  if (query.tickers?.length) {
    const want = new Set(query.tickers.map((t) => t.toUpperCase()));
    items = items.filter((i) => i.tickers.some((t) => want.has(t)));
  }
  return { items: items.slice(0, query.limit ?? items.length), nextCursor: null, total: items.length };
}

const sampleEnvelope = (query: NewsQuery): NewsEnvelope => ({
  data: filterSample(query),
  fetchedAt: Date.now(),
  stale: false,
  error: null,
  source: "sample",
  configured: false,
  preview: true,
});

// ---------------------------------------------------------------------------------------------
// self-healing refresh
// ---------------------------------------------------------------------------------------------

let refreshing: Promise<unknown> | null = null;

/**
 * Keeps the wire moving without depending on the cron being wired up (it is not, in dev).
 * An empty store is worth waiting for once; a merely stale one refreshes in the background
 * so the reader gets the stories we already have, immediately.
 */
async function refreshIfNeeded(): Promise<void> {
  const newest = await newestPublishedAt().catch(() => null);
  const stale = !newest || Date.now() - newest.getTime() > staleMinutes() * 60_000;
  if (!stale) return;

  if (!refreshing) {
    refreshing = collectNews()
      .catch((e) => console.warn("[news/refresh]", (e as Error).message))
      .finally(() => {
        refreshing = null;
      });
  }
  // Nothing to show yet? Wait for this run. Otherwise serve what we have and let it finish.
  if (!newest) await refreshing;
}

// ---------------------------------------------------------------------------------------------
// reader
// ---------------------------------------------------------------------------------------------

export async function getNews(query: NewsQuery = {}): Promise<NewsEnvelope> {
  if (API_URL) {
    try {
      return { data: await fetchFromProvider(query), fetchedAt: Date.now(), stale: false, error: null, source: API_URL, configured: true, preview: false };
    } catch (e) {
      const message = (e as Error).message;
      if (PREVIEW) return { ...sampleEnvelope(query), error: message };
      return { data: null, fetchedAt: Date.now(), stale: false, error: message, source: API_URL, configured: true, preview: false };
    }
  }

  if (!hasStore()) {
    return publicWire(query);
  }

  try {
    await refreshIfNeeded();
    const feed = await listNews(query);
    // An empty store in dev still shows the sample, so the pages can be worked on before
    // the first collection lands.
    if (feed.items.length === 0 && (feed.total ?? 0) === 0 && PREVIEW) return sampleEnvelope(query);
    return { data: feed, fetchedAt: Date.now(), stale: false, error: null, source: "collector", configured: true, preview: false };
  } catch (e) {
    const message = (e as Error).message;
    if (PREVIEW) return { ...sampleEnvelope(query), error: message };
    return { data: null, fetchedAt: Date.now(), stale: false, error: message, source: "collector", configured: true, preview: false };
  }
}
