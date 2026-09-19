/**
 * Google News RSS — SOURCE_INVENTORY.md §3.1.
 *
 * Broad discovery. The inventory's own queries hunt viral culture; the newswire's default
 * queries hunt the subjects this site pairs to — the chain, the launchpad, and the themes
 * behind the narrative baskets. Override with GOOGLE_NEWS_QUERIES (pipe-separated).
 *
 * Google is an aggregator: the item title carries the real publisher after the last dash,
 * and that publisher is credited rather than Google.
 */
import { requestFeed } from "../http";
import { parseFeed } from "../xml";
import { type Adapter, type RawStory } from "./types";

const ENDPOINT = "https://news.google.com/rss/search";

/**
 * One query per narrative basket, written with company names rather than tickers: Google
 * indexes prose, and a headline that says "Broadcom" is the one that resolves to $AVGO
 * downstream. Queries that merely name the chain are deliberately absent — they return
 * syndicated token promotion, which the collector then has to throw away.
 */
const DEFAULT_QUERIES = [
  '(Nvidia OR Broadcom OR Marvell OR Arista OR "Super Micro") stock when:1d',
  '(TSMC OR ASML OR Micron OR "Applied Materials" OR Intel) chip stock when:1d',
  '(Tesla OR Apple OR Microsoft OR Alphabet OR Amazon OR Meta) stock when:1d',
  '(Coinbase OR MicroStrategy OR Circle OR "Robinhood Markets") stock when:1d',
  '("Constellation Energy" OR Oklo OR Vistra OR "GE Vernova") datacenter power when:1d',
  '(Palantir OR "Rocket Lab" OR IonQ OR AppLovin) stock when:1d',
];

function splitPublisher(title: string): { title: string; publisher: string | null } {
  const i = title.lastIndexOf(" - ");
  if (i < 20) return { title, publisher: null };
  return { title: title.slice(0, i).trim(), publisher: title.slice(i + 3).trim() || null };
}

export const googleNews: Adapter = {
  key: "google-news",
  label: "Google News",
  envFlag: "SOURCE_GOOGLE_NEWS",
  defaultOn: true,
  async collect() {
    const queries = (process.env.GOOGLE_NEWS_QUERIES?.trim() || "")
      .split("|")
      .map((q) => q.trim())
      .filter(Boolean);
    const list = queries.length > 0 ? queries : DEFAULT_QUERIES;

    const out: RawStory[] = [];
    for (const q of list) {
      const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await requestFeed(url);
      for (const item of parseFeed(xml)) {
        if (!item.published) continue;
        const { title, publisher } = splitPublisher(item.title);
        if (title.length < 20) continue;

        out.push({
          sourceKey: "google-news",
          sourceName: item.sourceName?.trim() || publisher || "Google News",
          lane: "market",
          tier: 3,
          title,
          summary: item.description?.slice(0, 400) ?? null,
          url: item.link,
          imageUrl: item.imageUrl,
          publishedAt: item.published,
          symbolHints: [],
        });
      }
    }
    return out;
  },
};
