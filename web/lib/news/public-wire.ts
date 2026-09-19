import { requestFeed } from "./http";
import { parseFeed } from "./xml";
import { linkStory } from "./linkage";
import type { NewsEnvelope, NewsItem } from "./types";
import type { NewsQuery } from "./source";

// Public reporting without a database. The configured provider / collector take precedence.
const SOURCES = [
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "Google News", url: "https://news.google.com/rss/search?q=Nvidia+OR+Tesla+OR+Microsoft+OR+Apple+stock+when:2d&hl=en-US&gl=US&ceid=US:en" },
];
let cache: { items: NewsItem[]; at: number } | null = null;
let inflight: Promise<void> | null = null;
let failure: string | null = null;
async function refresh() {
  const results = await Promise.allSettled(SOURCES.map(async source => {
    const xml = await requestFeed(source.url, undefined, 8000);
    return parseFeed(xml).flatMap((item): NewsItem[] => {
      if (!item.published || !item.link || !/^https?:\/\//.test(item.link)) return [];
      const age = Date.now() - item.published.getTime();
      if (age < -300000 || age > 7 * 86400000) return [];
      const publisher = item.sourceName || source.name;
      const title = item.title.replace(new RegExp(" - " + publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "");
      const linked = linkStory(title);
      if (!linked.tickers.length && !linked.venue) return [];
      return [{ id: item.link, title, summary: null, url: item.link, imageUrl: item.imageUrl,
        source: { name: publisher, domain: new URL(item.link).hostname }, publishedAt: item.published.toISOString(),
        category: linked.category, tickers: linked.tickers, narratives: linked.narratives }];
    });
  }));
  const items = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  if (!items.length) { failure = "News sources are temporarily unavailable."; return; }
  const unique = new Map(items.map(i => [i.title.toLowerCase().replace(/[^a-z0-9]/g, ""), i]));
  cache = { items: [...unique.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)), at: Date.now() };
  failure = results.some(r=>r.status==="rejected") ? "One news source is temporarily unavailable." : null;
}
export async function publicWire(query: NewsQuery): Promise<NewsEnvelope> {
  if (!cache || Date.now()-cache.at > 60000) {
    if (!inflight) inflight = refresh().catch(()=>{failure="News sources are temporarily unavailable.";}).finally(()=>{inflight=null;});
    await inflight;
  }
  const items = (cache?.items ?? []).filter(i => (!query.category || query.category==="all" || i.category===query.category) && (!query.tickers?.length || i.tickers.some(t=>query.tickers!.includes(t))));
  return { data: cache ? { items: items.slice(0,query.limit??24), total:items.length, nextCursor:null } : null,
    fetchedAt: cache?.at ?? Date.now(), stale: !!cache && Date.now()-cache.at>60000, error:failure,
    source:"public-rss",configured:true,preview:false };
}
