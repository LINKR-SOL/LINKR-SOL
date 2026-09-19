export interface HeroCandle { t: number; close: number; volume: number }
export interface HeroHistory {
  candles: HeroCandle[];
  fetchedAt: number;
  stale: boolean;
  sourceUrl: string;
  error: string | null;
}
export const HERO_TOKEN = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

/** Completed daily observations only; no interpolated or fabricated candles. */
export function parseHeroCandles(rows: unknown, now = Date.now()): HeroCandle[] {
  if (!Array.isArray(rows)) return [];
  const unique = new Map<number, HeroCandle>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, , , , close, volume] = row;
    if (![t, close, volume].every(v => typeof v === "number" && Number.isFinite(v))) continue;
    if (t <= 0 || close <= 0 || volume < 0 || (t + 86400) * 1000 > now) continue;
    unique.set(t, { t, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.t - b.t).slice(-14);
}
