/**
 * Coins taken off the site. HIDDEN_COINS lists vault and/or coin (mint) addresses, comma-separated, in the server's
 * environment, so hiding or bringing a coin back is a variable change, not a code change, and the list never ships in
 * the repository. A hidden coin is left out of every list and feed, and its pages and API answer "not found".
 *
 * Only what the site shows changes: the keeper reads the database directly, so a hidden coin's fees, payouts and
 * airdrops to its holders carry on.
 */
const hidden = new Set(
  (process.env.HIDDEN_COINS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean),
);

/** True when any of the given addresses (a vault, its coin's mint, a creator) is hidden. */
export function isHidden(...addresses: (string | null | undefined)[]): boolean {
  return hidden.size > 0 && addresses.some((a) => !!a && hidden.has(a));
}
