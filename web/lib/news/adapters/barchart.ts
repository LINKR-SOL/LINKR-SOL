/**
 * Barchart news stream — SOURCE_INVENTORY.md §3.5.
 *
 * A POST whose public request body the inventory documents exactly; `before` is the
 * current Unix timestamp at runtime. Two quirks the capture confirms: the top-level
 * `items` is itself a JSON-encoded string, and `published` is a Central-Time label with no
 * year ("Thu Sep 3, 2:41PM CDT"), which has to be converted before it can be compared to
 * anything. `feedName` is the upstream wire (often AP), so it — not Barchart — is credited.
 */
import { requestJsonPost } from "../http";
import { type Adapter, type RawStory } from "./types";

const ENDPOINT = "https://www.barchart.com/news/load-more-stories";
const REFERER = "https://www.barchart.com/news";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Hours to add to a wall-clock label to reach UTC. */
const ZONES: Record<string, number> = { CDT: 5, CST: 6, EDT: 4, EST: 5, MDT: 6, MST: 7, PDT: 7, PST: 8, UTC: 0, GMT: 0 };

/** "Thu Sep 3, 2:41PM CDT" -> Date. The year is absent, so it is inferred as the most
 *  recent one that does not put the story in the future. */
export function parseBarchartDate(label: string, now = new Date()): Date | null {
  const m = label
    .trim()
    .match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*([A-Z]{2,4})$/i);
  if (!m) return null;

  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const day = Number(m[2]);
  let hour = Number(m[3]) % 12;
  if (m[5].toUpperCase() === "PM") hour += 12;
  const offset = ZONES[m[6].toUpperCase()];
  if (offset === undefined) return null;

  const build = (year: number) => new Date(Date.UTC(year, month, day, hour + offset, Number(m[4])));
  let d = build(now.getUTCFullYear());
  if (d.getTime() - now.getTime() > 36 * 3_600_000) d = build(now.getUTCFullYear() - 1);
  return Number.isFinite(d.getTime()) ? d : null;
}

interface Item {
  id?: string | number;
  slug?: string;
  title?: string;
  feedName?: string;
  published?: string;
}

export const barchart: Adapter = {
  key: "barchart",
  label: "Barchart",
  envFlag: "SOURCE_BARCHART",
  defaultOn: true,
  async collect() {
    const body = await requestJsonPost<{ items?: string | Item[] }>(
      ENDPOINT,
      {
        before: Math.floor(Date.now() / 1000),
        section: "overview",
        subSection: "",
        search: [],
        useThumbnail: false,
        symbolType: false,
      },
      { referer: REFERER },
    );

    const raw = typeof body.items === "string" ? (JSON.parse(body.items) as Item[]) : (body.items ?? []);
    const out: RawStory[] = [];

    for (const it of raw) {
      const title = it.title?.trim();
      if (!title || !it.id || !it.slug || !it.published) continue;
      const at = parseBarchartDate(it.published);
      if (!at) continue;

      out.push({
        sourceKey: "barchart",
        sourceName: it.feedName?.trim() || "Barchart",
        lane: "market",
        tier: 2,
        title,
        summary: null,
        url: `https://www.barchart.com/story/news/${it.id}/${it.slug}`,
        imageUrl: null,
        publishedAt: at,
        symbolHints: [],
      });
    }
    return out;
  },
};
