/** A story as a source hands it over, before any gate has run. */
export interface RawStory {
  /** Stable key for source-health rows and the `source.key` on the stored doc. */
  sourceKey: string;
  /** What the reader is shown. For an aggregator this is the upstream publisher when the
   *  feed names one — Yahoo and Google both carry other people's reporting. */
  sourceName: string;
  lane: "market" | "chain" | "macro" | "culture";
  /** 1 = first-party / structured market data, 2 = publisher feed, 3 = aggregator. */
  tier: 1 | 2 | 3;
  title: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  /** Symbols the source itself attached to the story. Trusted over our own extraction. */
  symbolHints: string[];
  /** Structured markers the inventory tracks: `halt`, `filing`, `macro_release`. */
  signals?: Record<string, string | number | boolean>;
}

export interface Adapter {
  key: string;
  label: string;
  /** Env flag that turns the source on; absent means always on. */
  envFlag?: string;
  /** Sources the inventory ships disabled stay disabled unless the flag is explicitly set. */
  defaultOn: boolean;
  collect(): Promise<RawStory[]>;
}

export function envOn(flag: string | undefined, defaultOn: boolean): boolean {
  if (!flag) return defaultOn;
  const v = process.env[flag]?.trim();
  if (v === undefined || v === "") return defaultOn;
  return v === "1" || v.toLowerCase() === "true";
}

export function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function envNumber(name: string, fallback: number, min?: number, max?: number): number {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v) || process.env[name] === undefined || process.env[name] === "") return fallback;
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}
