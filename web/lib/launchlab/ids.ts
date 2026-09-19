import { PublicKey } from "@solana/web3.js";
import { envText, isMainnet } from "../solana/cluster";

/**
 * Raydium LaunchLab is the venue StonkFun launches on: a coin trades on a bonding curve first and migrates into a
 * Raydium CPMM pool once the curve has raised its target in the quote asset. StonkFun attributes a pool to itself
 * through the `platformId` the create instruction carries, and forwards the creator's share of the curve fee to
 * the pool's `creator` account — which for a LINKR launch is the vault.
 *
 * Devnet has the same program under a different id but no StonkFun platform; LINKR registers its own platform
 * config there (scripts/launchlab-devnet-platform.ts) so the whole flow can be exercised without real money.
 */

export const LAUNCHLAB_PROGRAM_ID = new PublicKey(isMainnet ? "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj" : "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6");
/** The CPMM program a graduated curve migrates into. Its pool vaults are owned by `CPMM_AUTHORITY`. */
export const CPMM_PROGRAM_ID = new PublicKey(isMainnet ? "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C" : "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
export const CPMM_AUTHORITY = new PublicKey(isMainnet ? "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL" : "CXniRufdq5xL8t8jZAPxsPZDpuudwuJSPWnbcD5Y5Nxq");

/** StonkFun's platform configs on mainnet. Standard pays the creator; reward taxes transfers for holders instead. */
export const STONKFUN_PLATFORM_STANDARD = new PublicKey("4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7");
export const STONKFUN_PLATFORM_REWARD = new PublicKey("6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt");

/** Where StonkFun's public API and token pages live. */
export const STONKFUN_ORIGIN = envText(process.env.STONKFUN_API_ORIGIN) ?? "https://www.stonkfun.xyz";
export const STONKFUN_API = `${STONKFUN_ORIGIN}/api/public/v1`;

/**
 * The platform a launch is attributed to (server side). Mainnet: StonkFun's standard platform unless overridden.
 * Devnet: the platform the setup script created, from LAUNCHLAB_PLATFORM_ID — there is nothing to fall back to.
 */
export function platformId(): PublicKey | null {
  const raw = envText(process.env.LAUNCHLAB_PLATFORM_ID);
  if (raw) return new PublicKey(raw);
  return isMainnet ? STONKFUN_PLATFORM_STANDARD : null;
}

export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** A coin's page on the venue: StonkFun on mainnet, the explorer elsewhere. */
export const coinUrl = (mint: string) => (isMainnet ? `${STONKFUN_ORIGIN}/token/${mint}` : `https://solscan.io/token/${mint}?cluster=devnet`);
