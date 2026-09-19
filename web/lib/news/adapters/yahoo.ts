/**
 * Yahoo Finance front page — SOURCE_INVENTORY.md §3.3.
 *
 * The public, server-rendered story stream on finance.yahoo.com. The logged-in
 * notification API is deliberately not called. Yahoo aggregates other publishers, so the
 * story keeps the `publisher` label Yahoo itself prints rather than being credited to Yahoo.
 *
 * The parse is anchored on the markup the capture in feeds-backend-explanation/ shows:
 * an <h3> headline inside a story link, with `text summary`, `publisher`, `published-date`
 * and `symbol` spans alongside it. Anything without a usable relative timestamp is dropped
 * rather than dated to "now" — a wrong age would move a stale story to the top of the wire.
 */
import { requestText } from "../http";
import { stripTags } from "../xml";
import { type Adapter, type RawStory } from "./types";

const HOME = "https://finance.yahoo.com/";

/** "2h ago" / "15 minutes ago" / "3d ago" -> ms. Anything else is unusable. */
function ageMs(label: string): number | null {
  const m = label.trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2][0];
  const per = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * per;
}

function first(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

export const yahoo: Adapter = {
  key: "yahoo",
  label: "Yahoo Finance",
  envFlag: "SOURCE_YAHOO_FINANCE",
  defaultOn: true,
  async collect() {
    const html = await requestText(HOME, { maxBytes: 2_000_000 });
    const out: RawStory[] = [];
    const seen = new Set<string>();

    for (const m of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)) {
      const title = stripTags(m[1]);
      const at = m.index ?? 0;
      if (title.length < 20) continue;

      const before = html.slice(Math.max(0, at - 2600), at);
      const after = html.slice(at, at + 2600);

      // The story link is the anchor wrapping the headline: the last href before it.
      const hrefs = [...before.matchAll(/href="([^"]+)"/g)].map((h) => h[1]);
      const href = hrefs.reverse().find((h) => /\.html($|\?)/.test(h) && !/\/quote\//.test(h));
      if (!href) continue;

      let url: string;
      try {
        url = new URL(href, HOME).toString();
      } catch {
        continue;
      }
      if (!/(^|\.)yahoo\.com$/.test(new URL(url).hostname) || seen.has(url)) continue;

      const label = first(/<span class="published-date"[^>]*>([\s\S]*?)<\/span>/, after);
      const age = label ? ageMs(stripTags(label)) : null;
      if (age === null) continue;

      seen.add(url);
      const publisher = first(/<span class="publisher"[^>]*>([\s\S]*?)<\/span>/, after);
      const summary = first(/<p class="text summary[^"]*"[^>]*>([\s\S]*?)<\/p>/, after);
      const image = [...before.matchAll(/<img\b[^>]*class="[^"]*story-img[^"]*"[^>]*src="([^"]+)"/g)].pop()?.[1] ?? null;
      const symbols = [...after.matchAll(/<span class="symbol">([A-Z.\-]{1,8})<\/span>/g)].map((s) => s[1]);

      out.push({
        sourceKey: "yahoo",
        sourceName: publisher ? stripTags(publisher) : "Yahoo Finance",
        lane: "market",
        tier: 2,
        title,
        summary: summary ? stripTags(summary).slice(0, 400) || null : null,
        url,
        imageUrl: image,
        publishedAt: new Date(Date.now() - age),
        symbolHints: symbols,
      });
    }

    return out;
  },
};
