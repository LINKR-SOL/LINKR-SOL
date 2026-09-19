/**
 * Duplicate detection.
 *
 * SOURCE_INVENTORY.md §4.5A rejects an exact identity collision and penalises a similar
 * one at >= 0.82 similarity. The newswire applies the same two thresholds to headlines:
 * an aggregator, a wire and the publisher itself routinely file the same story minutes
 * apart, and the reader should see it once.
 */

/** Normalised headline key: an exact-duplicate check that survives punctuation and case. */
export function fingerprint(title: string, url: string | null): string {
  const key = title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 14)
    .join(" ");
  return hash(key || (url ?? title));
}

/** FNV-1a, hex. Deterministic across instances, which is what makes the _id an upsert key. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "as", "at", "by", "and", "is", "are", "its", "after", "with"]);

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Sørensen–Dice over content words. 1.0 is identical wording, 0 is nothing shared. */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

export const SIMILAR_THRESHOLD = 0.82;

/** The first title in `against` that is effectively the same story, if any. */
export function findNearDuplicate(title: string, against: string[], threshold = SIMILAR_THRESHOLD): string | null {
  for (const other of against) if (similarity(title, other) >= threshold) return other;
  return null;
}
