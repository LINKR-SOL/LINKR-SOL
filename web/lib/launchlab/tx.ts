import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buyExactInInstruction, initializeWithToken2022, sellExactInInstruction } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { TOKEN_2022_PROGRAM_ID, WSOL_MINT } from "./ids";
import { creatorFeeVault, launchpadAuth, launchpadPoolId, launchpadVaultId, platformFeeVault } from "./pool";
import type { LaunchPricing } from "./pricing";

/**
 * Instruction builders for LaunchLab, usable from the browser (the wizard, the devnet trade panel) and from
 * scripts. They mirror StonkFun's "build it yourself" guide: the create names the vault as `creator` and the
 * user as `payer`, the platform id attributes the pool, and the curve-rule account rides along last.
 */

const bn = (v: bigint | string | number) => new BN(v.toString());

export interface CreateLaunchParams {
  pricing: LaunchPricing;
  /** pays rent and fees, signs */
  payer: PublicKey;
  /** the account StonkFun forwards creator fees to — the vault */
  creator: PublicKey;
  /** fresh keypair's public key; it signs the transaction too */
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}

export interface LaunchAccounts {
  poolId: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
}

export function launchAccounts(mint: PublicKey, quote: PublicKey): LaunchAccounts {
  const poolId = launchpadPoolId(mint, quote);
  return { poolId, vaultA: launchpadVaultId(poolId, mint), vaultB: launchpadVaultId(poolId, quote) };
}

/** `initialize_with_token_2022`: a Token-2022 base mint with metadata, its curve, and the two pool vaults. */
export function createLaunchIx(p: CreateLaunchParams): TransactionInstruction {
  const programId = new PublicKey(p.pricing.programId);
  const quote = new PublicKey(p.pricing.quote.mint);
  const { poolId, vaultA, vaultB } = launchAccounts(p.mint, quote);
  return initializeWithToken2022(
    programId,
    p.payer,
    p.creator,
    new PublicKey(p.pricing.configId),
    new PublicKey(p.pricing.platformId),
    launchpadAuth(),
    poolId,
    p.mint,
    quote,
    vaultA,
    vaultB,
    new PublicKey(p.pricing.quote.tokenProgram),
    p.pricing.baseDecimals,
    p.name,
    p.symbol,
    p.uri,
    { type: "ConstantCurve", totalSellA: bn(p.pricing.totalSellA), migrateType: "cpmm", supply: bn(p.pricing.supply), totalFundRaisingB: bn(p.pricing.totalFundRaisingB) },
    new BN(0),
    new BN(0),
    new BN(0),
    p.pricing.cpmmCreatorFeeOn,
    undefined,
    undefined,
    p.pricing.curveRuleId ? new PublicKey(p.pricing.curveRuleId) : undefined,
  );
}

export interface TradeParams {
  programId: PublicKey;
  configId: PublicKey;
  platformId: PublicKey;
  /** the pool's creator, for its fee vault */
  creator: PublicKey;
  mint: PublicKey;
  quote: PublicKey;
  quoteTokenProgram: PublicKey;
  /** the trader; signs */
  owner: PublicKey;
}

/**
 * `buy_exact_in`: spend `amountB` of the quote for at least `minAmountA` coins. SOL is wrapped for the trade and
 * unwrapped after it; a token quote is spent from the owner's existing token account.
 */
export function buyIxs(t: TradeParams, amountB: bigint, minAmountA: bigint): TransactionInstruction[] {
  const { poolId, vaultA, vaultB } = launchAccounts(t.mint, t.quote);
  const ataA = getAssociatedTokenAddressSync(t.mint, t.owner, true, TOKEN_2022_PROGRAM_ID);
  const ataB = getAssociatedTokenAddressSync(t.quote, t.owner, true, t.quoteTokenProgram);
  const isSol = t.quote.equals(WSOL_MINT);
  const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(t.owner, ataA, t.owner, t.mint, TOKEN_2022_PROGRAM_ID)];
  if (isSol) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(t.owner, ataB, t.owner, t.quote, t.quoteTokenProgram),
      SystemProgram.transfer({ fromPubkey: t.owner, toPubkey: ataB, lamports: amountB }),
      createSyncNativeInstruction(ataB, t.quoteTokenProgram),
    );
  }
  ixs.push(
    buyExactInInstruction(
      t.programId,
      t.owner,
      launchpadAuth(),
      t.configId,
      t.platformId,
      poolId,
      ataA,
      ataB,
      vaultA,
      vaultB,
      t.mint,
      t.quote,
      TOKEN_2022_PROGRAM_ID,
      t.quoteTokenProgram,
      platformFeeVault(t.platformId, t.quote),
      creatorFeeVault(t.creator, t.quote),
      bn(amountB),
      bn(minAmountA),
    ),
  );
  if (isSol) ixs.push(createCloseAccountInstruction(ataB, t.owner, t.owner, [], t.quoteTokenProgram));
  return ixs;
}

/** `sell_exact_in`: sell `amountA` coins for at least `minAmountB` of the quote. */
export function sellIxs(t: TradeParams, amountA: bigint, minAmountB: bigint): TransactionInstruction[] {
  const { poolId, vaultA, vaultB } = launchAccounts(t.mint, t.quote);
  const ataA = getAssociatedTokenAddressSync(t.mint, t.owner, true, TOKEN_2022_PROGRAM_ID);
  const ataB = getAssociatedTokenAddressSync(t.quote, t.owner, true, t.quoteTokenProgram);
  const isSol = t.quote.equals(WSOL_MINT);
  const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(t.owner, ataB, t.owner, t.quote, t.quoteTokenProgram)];
  ixs.push(
    sellExactInInstruction(
      t.programId,
      t.owner,
      launchpadAuth(),
      t.configId,
      t.platformId,
      poolId,
      ataA,
      ataB,
      vaultA,
      vaultB,
      t.mint,
      t.quote,
      TOKEN_2022_PROGRAM_ID,
      t.quoteTokenProgram,
      platformFeeVault(t.platformId, t.quote),
      creatorFeeVault(t.creator, t.quote),
      bn(amountA),
      bn(minAmountB),
    ),
  );
  if (isSol) ixs.push(createCloseAccountInstruction(ataB, t.owner, t.owner, [], t.quoteTokenProgram));
  return ixs;
}

/** Trade params for a pool that was just created from `pricing` (its creator is the vault). */
export function tradeParamsFromPricing(pricing: LaunchPricing, mint: PublicKey, creator: PublicKey, owner: PublicKey): TradeParams {
  return {
    programId: new PublicKey(pricing.programId),
    configId: new PublicKey(pricing.configId),
    platformId: new PublicKey(pricing.platformId),
    creator,
    mint,
    quote: new PublicKey(pricing.quote.mint),
    quoteTokenProgram: new PublicKey(pricing.quote.tokenProgram),
    owner,
  };
}
