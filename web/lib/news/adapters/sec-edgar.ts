/**
 * SEC EDGAR current filings — SOURCE_INVENTORY.md §3.9.
 *
 * Shipped disabled, exactly as the inventory has it, and it stays off until SEC_USER_AGENT
 * carries a real contact string: EDGAR requires an identifying agent, and sending a
 * generic one would be abusing an official endpoint. A filing is confirmation-grade
 * evidence; the same linkage and freshness gates still apply to it.
 */
import { requestFeed } from "../http";
import { parseFeed } from "../xml";
import { envList, type Adapter, type RawStory } from "./types";

const ENDPOINT = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&count=100&output=atom";

export const secEdgar: Adapter = {
  key: "sec-edgar",
  label: "SEC EDGAR",
  envFlag: "SOURCE_SEC_EDGAR",
  defaultOn: false,
  async collect() {
    const agent = process.env.SEC_USER_AGENT?.trim();
    if (!agent) throw new Error("SEC_USER_AGENT is required by EDGAR; source produces nothing without it");

    const terms = envList("SEC_WATCH_TERMS", ["TSLA", "NVDA", "META", "AAPL", "MSFT"]).map((t) => t.toLowerCase());
    const xml = await requestFeed(ENDPOINT, agent);

    const out: RawStory[] = [];
    for (const item of parseFeed(xml)) {
      if (!item.published) continue;
      const hay = `${item.title} ${item.description ?? ""}`.toLowerCase();
      if (terms.length > 0 && !terms.some((t) => hay.includes(t))) continue;

      out.push({
        sourceKey: "sec-edgar",
        sourceName: "SEC EDGAR",
        lane: "market",
        tier: 1,
        title: item.title,
        summary: item.description,
        url: item.link,
        imageUrl: null,
        publishedAt: item.published,
        symbolHints: [],
        signals: { filing: true },
      });
    }
    return out;
  },
};
