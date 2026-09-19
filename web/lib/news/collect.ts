/**
 * The newswire collector.
 *
 * Runs every enabled source, applies the gates from feeds-backend-explanation/SOURCE_INVENTORY.md,
 * and upserts what survives into Mongo. The page never waits on an upstream source: it
 * reads the collection, and this runs on a cron.
 *
 * The gates, in order:
 *  1. Freshness  — a story with no usable timestamp is dropped, never dated to "now",
 *     and anything older than NEWS_MAX_AGE_HOURS does not enter the wire. (The 20-minute
 *     window in the inventory is an *alerting* gate for the Telegram bot; a web feed that
 *     only showed the last 20 minutes would be empty most of the day, so the web wire
 *     keeps the rule and widens the window.)
 *  2. Linkage    — §1.2, narrowed: the story must resolve to a stock that exists as a
 *     xStock on Solana, or be about the chain / launchpad itself.
 *  3. Provenance — §1.3: chain/indexer lanes cannot establish a story on their own.
 *  4. Duplicates — §4.5A: exact fingerprint collisions upsert; near-duplicates (Dice
 *     >= 0.82) are dropped so one story does not arrive three times from three feeds.
 *
 * Every source's outcome is written to `source_runs` whether it succeeded or failed, so a
 * dead source is visible instead of silently thinning the wire.
 */
import { collections, ensureIndexes } from "../db/collections";
import type { NewsDoc } from "../db/types";
import { enabledAdapters, type RawStory } from "./adapters";
import { findNearDuplicate, fingerprint } from "./dedupe";
import { hostOf } from "./http";
import { linkStory } from "./linkage";
import { enrichStories } from "./enrich";

const LOCK_ID = "news:collect";

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

const maxAgeHours = () => envNumber("NEWS_MAX_AGE_HOURS", 48);
/** Google News alone returns 50+ items per query. Without a per-source ceiling the
 *  aggregator would crowd out the publisher feeds that actually break the story. */
const maxPerSource = () => envNumber("NEWS_MAX_PER_SOURCE", 25);
const requireStockLink = () => (process.env.NEWS_REQUIRE_STOCK_LINK?.trim() ?? "1") !== "0";
/** Off by default: chain stories from aggregators are mostly syndicated token promotion.
 *  Turn it on to trade that noise for more Solana / StonkFun coverage. */
const allowAggregatorVenue = () => process.env.NEWS_ALLOW_AGGREGATOR_VENUE?.trim() === "1";

export interface SourceReport {
  source: string;
  items: number;
  kept: number;
  /** Why the rest were dropped — the fastest way to tell a dead source from a noisy one. */
  dropped: { stale: number; unlinked: number; promo: number; duplicate: number };
  latencyMs: number;
  error: string | null;
}

/**
 * Promotion, which SOURCE_INVENTORY.md §1 rejects outright.
 *
 * Syndicated token press releases reach the aggregators dressed as market reporting —
 * "($FROG) Surpasses $25M Market Cap" carried by a real financial domain. They pass a
 * naive linkage check because they name the chain, so they are filtered on shape instead.
 * Tier-1 structured sources (halts, filings) are exempt; they cannot be promotional.
 */
const PROMO =
  /\b(press release|sponsored|globenewswire|pr ?newswire|business ?wire|accesswire|chainwire|presale|pre-sale|whitelist|airdrop|giveaway|100x|1000x|to the moon|buy now|don't miss|best crypto to buy)\b/i;
/** A cashtag in parentheses is the house style of token PR, and of almost nothing else. */
const PROMO_SHAPE = /\(\s*\$[A-Za-z0-9]{2,10}\s*\)/;

function isPromotional(text: string, tier: number): boolean {
  if (tier === 1) return false;
  return PROMO.test(text) || PROMO_SHAPE.test(text);
}

export interface CollectReport {
  ran: boolean;
  reason?: string;
  sources: SourceReport[];
  collected: number;
  inserted: number;
  updated: number;
  enriched: number;
  ms: number;
}

/**
 * Recency-weighted rank. Used to order the wire and to choose which stories are worth
 * spending an AI call on — never to decide whether a story is real.
 */
function scoreOf(story: RawStory, tickers: number): number {
  const ageHours = (Date.now() - story.publishedAt.getTime()) / 3_600_000;
  const recency = Math.max(0, 1 - ageHours / maxAgeHours());
  const tier = story.tier === 1 ? 1 : story.tier === 2 ? 0.8 : 0.6;
  const linkage = Math.min(1, tickers / 3);
  const structured = story.signals?.halt || story.signals?.filing ? 0.15 : 0;
  return Number((recency * 0.5 + tier * 0.25 + linkage * 0.2 + structured).toFixed(4));
}

async function acquireLease(owner: string, ttlMs: number): Promise<boolean> {
  const c = await collections();
  const now = new Date();
  try {
    const res = await c.locks.updateOne(
      { _id: LOCK_ID, expiresAt: { $lt: now } },
      { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true },
    );
    return res.matchedCount > 0 || res.upsertedCount > 0;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
}

async function releaseLease(owner: string): Promise<void> {
  const c = await collections();
  await c.locks.updateOne({ _id: LOCK_ID, owner }, { $set: { expiresAt: new Date(0) } });
}

/** Runs every enabled source once and stores what passes. */
export async function collectNews(opts: { force?: boolean } = {}): Promise<CollectReport> {
  const started = Date.now();
  const report: CollectReport = { ran: false, sources: [], collected: 0, inserted: 0, updated: 0, enriched: 0, ms: 0 };

  if (!process.env.MONGODB_URI?.trim()) {
    return { ...report, reason: "MONGODB_URI is not set", ms: Date.now() - started };
  }

  await ensureIndexes();
  const owner = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  if (!opts.force && !(await acquireLease(owner, 120_000))) {
    return { ...report, reason: "another collector run holds the lease", ms: Date.now() - started };
  }
  report.ran = true;

  try {
    const c = await collections();
    const adapters = enabledAdapters();

    // Sources are independent: one failing must not cost the others their run.
    const results = await Promise.all(
      adapters.map(async (a) => {
        const at = new Date();
        const t0 = Date.now();
        try {
          const stories = await a.collect();
          return { adapter: a, stories, error: null as string | null, at, latencyMs: Date.now() - t0 };
        } catch (e) {
          return { adapter: a, stories: [] as RawStory[], error: (e as Error).message, at, latencyMs: Date.now() - t0 };
        }
      }),
    );

    const cutoff = Date.now() - maxAgeHours() * 3_600_000;
    const skew = Date.now() + 10 * 60_000;

    // Recent headlines already stored, for the near-duplicate check.
    const recent = await c.news
      .find({ publishedAt: { $gte: new Date(cutoff) } }, { projection: { title: 1 } })
      .limit(400)
      .toArray();
    const seenTitles = recent.map((r) => r.title);

    const docs = new Map<string, NewsDoc>();
    const runRows = [];

    for (const { adapter, stories, error, at, latencyMs } of results) {
      let kept = 0;
      const dropped = { stale: 0, unlinked: 0, promo: 0, duplicate: 0 };
      const cap = maxPerSource();
      // Freshest first, so the cap keeps the newest of what a source offered.
      const ordered = [...stories].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

      for (const story of ordered) {
        if (kept >= cap) break;
        // 1. freshness
        const ts = story.publishedAt.getTime();
        if (!Number.isFinite(ts) || ts < cutoff || ts > skew) {
          dropped.stale++;
          continue;
        }

        // 3. provenance: a chain/indexer lane is confirmation only and cannot stand alone.
        if (story.lane === "chain") continue;

        // 2. linkage
        const text = `${story.title}\n${story.summary ?? ""}`;
        const link = linkStory(text, story.symbolHints);
        // A story with no resolvable ticker can still belong here if it is about the chain
        // or the launchpad — but only from a publisher feed. Left open to aggregators, that
        // exemption fills the wire with syndicated token PR that merely names the chain.
        const venueOnly = link.tickers.length === 0 && link.venue;
        const aggregatorVenue = venueOnly && story.tier >= 3 && !allowAggregatorVenue();
        if (requireStockLink() && ((link.tickers.length === 0 && !link.venue) || aggregatorVenue)) {
          dropped.unlinked++;
          continue;
        }

        if (isPromotional(text, story.tier)) {
          dropped.promo++;
          continue;
        }

        // 4. duplicates
        const id = fingerprint(story.title, story.url);
        if (docs.has(id)) {
          dropped.duplicate++;
          continue;
        }
        if (findNearDuplicate(story.title, seenTitles)) {
          dropped.duplicate++;
          continue;
        }

        seenTitles.push(story.title);
        kept++;

        docs.set(id, {
          _id: id,
          title: story.title,
          summary: story.summary,
          url: story.url,
          imageUrl: story.imageUrl,
          source: { key: story.sourceKey, name: story.sourceName, domain: hostOf(story.url) },
          publishedAt: story.publishedAt,
          collectedAt: new Date(),
          category: link.category,
          tickers: link.tickers.slice(0, 6),
          narratives: link.narratives,
          lane: story.lane,
          tier: story.tier,
          signals: story.signals ?? {},
          score: scoreOf(story, link.tickers.length),
          insight: null,
          sentiment: null,
          tags: [],
          enrichedAt: null,
        });
      }

      report.sources.push({ source: adapter.key, items: stories.length, kept, dropped, latencyMs, error });
      runRows.push({
        _id: `${adapter.key}:${at.toISOString()}`,
        source: adapter.key,
        lane: "news",
        startedAt: at,
        latencyMs,
        items: stories.length,
        kept,
        error,
      });
    }

    if (runRows.length > 0) {
      await c.sourceRuns.bulkWrite(
        runRows.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: r }, upsert: true } })),
        { ordered: false },
      );
    }

    report.collected = docs.size;

    if (docs.size > 0) {
      const res = await c.news.bulkWrite(
        [...docs.values()].map((doc) => ({
          updateOne: {
            filter: { _id: doc._id },
            // A re-seen story keeps whatever it has been enriched with; only the facts refresh.
            update: {
              $set: {
                title: doc.title,
                summary: doc.summary,
                url: doc.url,
                imageUrl: doc.imageUrl,
                source: doc.source,
                publishedAt: doc.publishedAt,
                category: doc.category,
                tickers: doc.tickers,
                narratives: doc.narratives,
                lane: doc.lane,
                tier: doc.tier,
                signals: doc.signals,
                score: doc.score,
              },
              $setOnInsert: {
                collectedAt: doc.collectedAt,
                insight: null,
                sentiment: null,
                tags: [],
                enrichedAt: null,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      report.inserted = res.upsertedCount;
      report.updated = res.modifiedCount;
    }

    report.enriched = await enrichStories();
  } finally {
    if (!opts.force) await releaseLease(owner).catch(() => {});
  }

  report.ms = Date.now() - started;
  return report;
}
