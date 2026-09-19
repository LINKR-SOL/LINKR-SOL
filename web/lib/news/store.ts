/**
 * Read side of the newswire: the collection the pages actually render.
 *
 * Reads never touch an upstream source, so a wire that is down degrades to "the last few
 * hours of stories" rather than a slow page.
 */
import { collections } from "../db/collections";
import type { NewsDoc } from "../db/types";
import type { NewsCategory, NewsFeed, NewsItem } from "./types";
import { usefulSummary } from "./types";

export interface StoreQuery {
  category?: NewsCategory | "all";
  tickers?: string[];
  limit?: number;
  cursor?: string | null;
}

/** `<publishedAt ms>:<id>` — stable under inserts, unlike a numeric offset. */
function encodeCursor(doc: NewsDoc): string {
  return `${doc.publishedAt.getTime()}:${doc._id}`;
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [ms, id] = cursor.split(":");
  const n = Number(ms);
  if (!Number.isFinite(n) || !id) return null;
  return { at: new Date(n), id };
}

export function toItem(doc: NewsDoc): NewsItem {
  return {
    id: doc._id,
    title: doc.title,
    summary: usefulSummary(doc.summary, doc.title),
    url: doc.url,
    imageUrl: doc.imageUrl,
    source: { name: doc.source.name, domain: doc.source.domain },
    publishedAt: doc.publishedAt.toISOString(),
    category: doc.category,
    tickers: doc.tickers,
    narratives: doc.narratives,
    insight: doc.insight,
    sentiment: doc.sentiment,
    tags: doc.tags,
  };
}

export async function listNews(query: StoreQuery = {}): Promise<NewsFeed> {
  const c = await collections();
  const limit = Math.min(60, Math.max(1, query.limit ?? 24));

  const filter: Record<string, unknown> = {};
  if (query.category && query.category !== "all") filter.category = query.category;
  if (query.tickers?.length) filter.tickers = { $in: query.tickers.map((t) => t.toUpperCase()) };

  if (query.cursor) {
    const c0 = decodeCursor(query.cursor);
    // Keyset pagination: strictly older, with the id breaking ties at an identical timestamp.
    if (c0) filter.$or = [{ publishedAt: { $lt: c0.at } }, { publishedAt: c0.at, _id: { $lt: c0.id } }];
  }

  const [docs, total] = await Promise.all([
    c.news
      .find(filter)
      .sort({ publishedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray(),
    c.news.countDocuments(query.category && query.category !== "all" ? { category: query.category } : {}),
  ]);

  const page = docs.slice(0, limit);
  return {
    items: page.map(toItem),
    nextCursor: docs.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    total,
  };
}

/** Newest story we hold, used to decide whether a read should kick off a collection. */
export async function newestPublishedAt(): Promise<Date | null> {
  const c = await collections();
  const doc = await c.news.find({}, { projection: { publishedAt: 1 } }).sort({ publishedAt: -1 }).limit(1).next();
  return doc?.publishedAt ?? null;
}

/** Per-source health, the `shadow-report` equivalent from SOURCE_INVENTORY.md §7. */
export async function sourceHealth(hours = 24) {
  const c = await collections();
  const since = new Date(Date.now() - hours * 3_600_000);
  const runs = await c.sourceRuns.find({ startedAt: { $gte: since } }).sort({ startedAt: -1 }).toArray();

  const bySource = new Map<string, { source: string; runs: number; items: number; kept: number; errors: number; lastError: string | null; lastRunAt: string | null; meanLatencyMs: number }>();
  for (const r of runs) {
    const row = bySource.get(r.source) ?? {
      source: r.source, runs: 0, items: 0, kept: 0, errors: 0, lastError: null, lastRunAt: null, meanLatencyMs: 0,
    };
    row.runs++;
    row.items += r.items;
    row.kept += r.kept;
    if (r.error) {
      row.errors++;
      row.lastError ??= r.error;
    }
    row.lastRunAt ??= r.startedAt.toISOString();
    row.meanLatencyMs = Math.round((row.meanLatencyMs * (row.runs - 1) + r.latencyMs) / row.runs);
    bySource.set(r.source, row);
  }

  return [...bySource.values()].sort((a, b) => b.items - a.items);
}
