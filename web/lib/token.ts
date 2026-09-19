/**
 * $LINKR, LINKR's own coin on StonkFun.
 *
 * ⚠️ SINGLE SOURCE OF TRUTH — the contract address (the mint) below. NEXT_PUBLIC_LINKR_MINT overrides it. The navbar
 * ticker, the hero's copyable contract address and every "Buy" link are derived from it.
 */
import { coinUrl } from "./launchlab/ids";

/** $LINKR only ever trades on StonkFun mainnet, so its links go there whatever cluster the site runs on. */
const STONKFUN = "https://www.stonkfun.xyz";

export const TOKEN_MINT: string = process.env.NEXT_PUBLIC_LINKR_MINT?.trim() || "9yTuQtzLHxFzdqKuuSiR2e9gYVYutG7nByVittYeVYdW";

/** True once a real mint has been set (a base58 Solana address, so a typo never becomes a live link). */
export const TOKEN_IS_LIVE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(TOKEN_MINT);

export const TOKEN = {
  name: "LINKR",
  symbol: "LINKR",
  mint: TOKEN_MINT,
} as const;

/** Any coin's page on the venue. */
export { coinUrl };

/** The coin's StonkFun page (www.stonkfun.xyz/token/<mint>), or StonkFun itself until it launches. */
export const COIN_URL = TOKEN_IS_LIVE ? `${STONKFUN}/token/${TOKEN_MINT}` : STONKFUN;

/** Shortened mint for display, e.g. 9htA…Xk2p. */
export const tokenAddressShort = TOKEN_IS_LIVE ? `${TOKEN_MINT.slice(0, 4)}…${TOKEN_MINT.slice(-4)}` : "TBA";
