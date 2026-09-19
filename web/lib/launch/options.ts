/**
 * The launch product's fixed choices, shared by the web wizard and the Telegram bot so a coin launched from
 * either one is configured the same way. Browser-safe: no server imports.
 */

/** Product limit: a coin pays its holders in at most ten stocks (matches the program's MAX_BASKET of 10). */
export const MAX_BASKET = 10;

export const NAME_MAX = 32;
export const SYMBOL_MAX = 10;
export const DESCRIPTION_MAX = 280;

/** StonkFun's creator share on the standard 1% pool: half of every curve trade's fee, forwarded to the creator. */
export const CREATOR_FEE_PCT = 0.5;

export const EPOCH_OPTIONS = [
  { label: "Every 10 minutes", seconds: 600 },
  { label: "Hourly", seconds: 3_600 },
  { label: "Every 12 hours", seconds: 43_200 },
  { label: "Daily", seconds: 86_400 },
  { label: "Every 3 days", seconds: 3 * 86_400 },
  { label: "Weekly", seconds: 7 * 86_400 },
  { label: "Every 2 weeks", seconds: 14 * 86_400 },
  { label: "Monthly", seconds: 30 * 86_400 },
];

/**
 * How long a published payout waits before its stocks are airdropped: a fifth of the payout period, capped at the
 * operator's window and never under a minute. Every period's stocks then land before the next period ends
 * (10 minutes → a 2-minute review; an hour or more → the operator's full window).
 */
export const reviewWindowFor = (epochLength: number, maxWindow: number) => Math.min(maxWindow, Math.max(60, Math.floor(epochLength / 5)));

/** After a period closes, about how long the keeper takes to publish the payout (one cron tick and a transaction). */
export const PUBLISH_LAG_S = 90;
/** After the review window, about how long until the stocks are in holders' wallets (the next keeper run). */
export const AIRDROP_LAG_S = 90;

/** When a payout closing at `periodEnd` should be in holders' wallets. */
export const landsAt = (periodEnd: number, reviewWindow: number) => periodEnd + PUBLISH_LAG_S + reviewWindow + AIRDROP_LAG_S;

export const fmtDuration = (s: number) =>
  s % 86_400 === 0 ? `${s / 86_400} day${s / 86_400 === 1 ? "" : "s"}` : s % 3_600 === 0 ? `${s / 3_600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`;

/* ---------------------------------------------------------------- basket weights (whole percents, sum 100) */

export function toWholePercents(shares: number[]): number[] {
  if (shares.length === 0) return [];
  const total = shares.reduce((s, v) => s + v, 0) || 1;
  const scaled = shares.map((v) => (v / total) * 100);
  const floors = scaled.map((v) => Math.max(1, Math.floor(v)));
  let deficit = 100 - floors.reduce((s, v) => s + v, 0);
  const order = scaled.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac).map((x) => x.i);
  let k = 0;
  while (deficit > 0) {
    floors[order[k % order.length]] += 1;
    deficit -= 1;
    k += 1;
  }
  while (deficit < 0) {
    const big = floors.indexOf(Math.max(...floors));
    if (floors[big] <= 1) break;
    floors[big] -= 1;
    deficit += 1;
  }
  return floors;
}

/** Adds an item and makes room for it by scaling everyone else down proportionally. */
export function withAdded<T extends { weight: number }>(prev: T[], item: T): T[] {
  if (prev.length === 0) return [{ ...item, weight: 100 }];
  const share = 100 / (prev.length + 1);
  const weights = toWholePercents([...prev.map((x) => x.weight * (1 - share / 100)), share]);
  return [...prev, item].map((x, i) => ({ ...x, weight: weights[i] }));
}

/** Removes the items matching `drop` and hands their weight back to the rest proportionally. */
export function withRemoved<T extends { weight: number }>(prev: T[], drop: (x: T) => boolean): T[] {
  const rest = prev.filter((x) => !drop(x));
  const weights = toWholePercents(rest.map((x) => x.weight));
  return rest.map((x, i) => ({ ...x, weight: weights[i] }));
}

export function evenWeights<T extends { weight: number }>(prev: T[]): T[] {
  const w = toWholePercents(prev.map(() => 1));
  return prev.map((x, i) => ({ ...x, weight: w[i] }));
}

export const basketValid = (weights: number[]) =>
  weights.length >= 1 && weights.length <= MAX_BASKET && weights.reduce((s, w) => s + w, 0) === 100 && weights.every((w) => Number.isInteger(w) && w >= 1);
