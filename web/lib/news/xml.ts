/**
 * A small RSS / Atom reader.
 *
 * The collector reads four feeds whose markup is stable and simple; pulling in an XML
 * parser for that is more dependency than the job needs. This handles the subset those
 * feeds actually use: <item>/<entry>, CDATA, numeric and named entities, and the handful
 * of link forms Atom allows.
 */

export interface FeedItem {
  title: string;
  link: string | null;
  description: string | null;
  published: Date | null;
  /** RSS <source> or Atom <author><name>, when the feed carries one. */
  sourceName: string | null;
  imageUrl: string | null;
  /** The item's own XML, for feeds that carry namespaced fields worth reading directly. */
  raw: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#34": '"',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#\d+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

/**
 * Entities are decoded *first*: several feeds (Google News among them) escape their HTML
 * inside CDATA, so `&lt;a href="…google.com…"&gt;` only becomes a strippable tag after a
 * decode pass. Stripping first left the markup as visible text — and a URL sitting in the
 * summary was enough to resolve the wrong ticker downstream.
 */
export function stripTags(s: string): string {
  return decodeEntities(decodeEntities(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function unwrap(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (cdata ? cdata[1] : raw).trim();
}

/** First occurrence of <tag>…</tag>, with attributes allowed on the open tag. */
export function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]) : null;
}

function attr(block: string, name: string, attribute: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["']`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  return Number.isFinite(d.getTime()) ? d : null;
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue;

    // Atom puts the URL on <link href>; RSS puts it in the element body.
    const link = tag(block, "link") || attr(block, "link", "href");
    const description = tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content");

    items.push({
      title: stripTags(title),
      link: link ? decodeEntities(link.trim()) : null,
      description: description ? stripTags(description) : null,
      published: parseDate(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated") ?? tag(block, "dc:date")),
      sourceName: tag(block, "source") ?? tag(block, "name"),
      imageUrl:
        attr(block, "media:content", "url") ??
        attr(block, "media:thumbnail", "url") ??
        (attr(block, "enclosure", "type")?.startsWith("image/") ? attr(block, "enclosure", "url") : null),
      raw: block,
    });
  }
  return items;
}
