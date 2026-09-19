/**
 * Optional AI reading of a story — SOURCE_INVENTORY.md §6.
 *
 * The rule from the inventory is kept exactly: the deterministic freshness, linkage,
 * provenance and duplicate gates all run *before* this, and nothing here can promote a
 * story that failed them or reject one that passed. It only writes the `insight`,
 * `sentiment` and `tags` fields the thesis panel renders.
 *
 * It is off unless OPENROUTER_TOKEN is set, capped per run, and grounded: the model is
 * given the headline and summary and told to work from those alone, so the panel is
 * reading the story rather than recalling the company.
 */
import { collections } from "../db/collections";
import { BRAND } from "../brand";
import { NARRATIVES } from "../narratives";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

interface Reading {
  insight: string;
  sentiment: "bullish" | "bearish" | "neutral";
  tags: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["insight", "sentiment", "tags"],
  properties: {
    insight: { type: "string", maxLength: 400 },
    sentiment: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    tags: {
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 24 },
    },
  },
} as const;

function prompt(story: { title: string; summary: string | null; tickers: string[]; narratives: string[] }): string {
  const baskets = NARRATIVES.filter((n) => story.narratives.includes(n.id))
    .map((n) => `${n.name} (${n.symbols.join(", ")})`)
    .join("; ");

  return [
    "You write one short note for a market newswire on LINKR, where a live catalyst is turned into a market paired to a basket of reference assets instead of a single ticker.",
    "",
    `Headline: ${story.title}`,
    story.summary ? `Summary: ${story.summary}` : "Summary: (none provided)",
    `Tokenised stocks this story touches: ${story.tickers.join(", ") || "(none)"}`,
    baskets ? `Relevant baskets: ${baskets}` : "",
    "",
    "Write `insight`: at most two sentences on what this means for those assets, and specifically whether the story cuts across several of them rather than one.",
    "Work only from the headline and summary above. Do not add facts, numbers, dates or price moves that are not in them; if they are too thin to say anything specific, say what the story would need to confirm instead of guessing.",
    "No hype, no advice, no imperatives. `tags` are 1-3 short topic labels (e.g. 'Capex', 'Regulation').",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Enriches the newest un-enriched stories. Returns how many readings were written. */
export async function enrichStories(): Promise<number> {
  const token = process.env.OPENROUTER_TOKEN?.trim();
  if (!token) return 0;

  const max = envNumber("NEWS_AI_MAX_PER_RUN", 12);
  if (max <= 0) return 0;

  const c = await collections();
  // Newest first, not highest-scoring: the wire renders newest first, so this is the order
  // that fills the top of the page a reader is actually looking at.
  const pending = await c.news
    .find({ enrichedAt: null, tickers: { $ne: [] } })
    .sort({ publishedAt: -1 })
    .limit(max)
    .toArray();
  if (pending.length === 0) return 0;

  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  let written = 0;

  // A few at a time: the calls are independent, and running them one by one made the
  // collection run longer than the reading it produced was worth.
  const concurrency = Math.max(1, envNumber("NEWS_AI_CONCURRENCY", 4));
  const queue = [...pending];

  const worker = async () => {
    for (;;) {
      const story = queue.shift();
      if (!story) return;
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "http-referer": process.env.NEXT_PUBLIC_SITE_URL ?? BRAND.github,
            "x-title": "LINKR Newswire",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 320,
            messages: [{ role: "user", content: prompt(story) }],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "newswire_reading",
                strict: true,
                schema: SCHEMA,
              },
            },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`openrouter ${res.status}`);

        const body = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const raw = body.choices?.[0]?.message?.content;
        if (!raw) throw new Error("no completion content");

        const reading = JSON.parse(raw) as Reading;
        const insight = reading.insight?.trim();

        await c.news.updateOne(
          { _id: story._id },
          {
            $set: {
              insight: insight || null,
              sentiment: reading.sentiment ?? null,
              tags: (reading.tags ?? []).slice(0, 3),
              enrichedAt: new Date(),
            },
          },
        );
        if (insight) written++;
      } catch (e) {
        // A failed reading must never hold up the story itself: stamp it so the run moves on,
        // and the wire shows the source's own summary instead.
        console.warn("[news/enrich]", story._id, (e as Error).message);
        await c.news.updateOne({ _id: story._id }, { $set: { enrichedAt: new Date() } });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return written;
}
