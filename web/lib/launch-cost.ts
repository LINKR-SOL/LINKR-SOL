/**
 * What a creator needs in their wallet before they can launch.
 *
 * A launch is two transactions — prepare the vault (plus its token accounts), then create the coin on LaunchLab
 * with the vault as creator — and all of the cost is rent, not fees. Checking affordability only at signing
 * time is too late: the first transaction can succeed and the second fail, leaving a paid-for vault with no coin.
 *
 * Rent figures are what the chain charges for the accounts the flow creates; the create cost is the rent of the
 * Token-2022 mint with its metadata, the pool account and the pool's two token vaults. StonkFun charges nothing
 * on this path. Headroom on top covers priority fees and an optional initial buy the creator adds at the last second.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Signatures across both transactions (create vault, create + bind) at 5000 lamports each, with margin. */
export const FEE_LAMPORTS = 3n * 5_000n;
/** Rent of the accounts `initialize_with_token_2022` creates (mint + metadata, pool, two vaults): 0.0113 SOL measured on devnet, with margin. */
export const CREATE_LAMPORTS = 13_000_000n;
/** Headroom for priority fees and a small initial buy: a tenth of the cost, but never less than a couple of dollars. */
export const HEADROOM_PCT = 10n;
export const HEADROOM_MIN_USD = 2;

export interface LaunchCost {
  vaultRent: bigint;
  createCost: bigint;
  headroom: bigint;
  /** What the wallet must hold. */
  required: bigint;
  /** What it actually costs — rent is refundable only if the accounts are ever closed. */
  spend: bigint;
}

/**
 * @param vaultRent  rent for the Vault PDA + its quote and basket token accounts (lamports)
 * @param solUsd     SOL price, for the minimum headroom; null falls back to the percentage alone
 * @param needsVault false when resuming a vault that already exists, so only the launch is left
 */
export function launchCost(vaultRent: bigint, solUsd: number | null, needsVault = true): LaunchCost {
  const rent = needsVault ? vaultRent : 0n;
  const spend = rent + CREATE_LAMPORTS + FEE_LAMPORTS;
  const pct = (spend * HEADROOM_PCT) / 100n;
  const floor = solUsd && solUsd > 0 ? BigInt(Math.ceil((HEADROOM_MIN_USD / solUsd) * 1e9)) : 0n;
  const headroom = pct > floor ? pct : floor;
  return { vaultRent: rent, createCost: CREATE_LAMPORTS, headroom, required: spend + headroom, spend };
}
