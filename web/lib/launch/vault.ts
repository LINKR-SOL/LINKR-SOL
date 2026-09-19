import { PublicKey } from "@solana/web3.js";
import { isCustodial } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { isBase58Address } from "../solana/address";
import { ensureTokens } from "../api/tokens";
import { findPair, SOL_PAIR } from "../launchlab/pairs";
import type { VaultBasketDoc } from "../db/types";
import { LaunchInputError } from "./errors";

export interface RegisterVaultInput {
  creator: string;
  salt: string;
  legs: { mint: string; tokenProgram: string }[];
  weightsBps: number[];
  epochLength: number;
  expectedMint: string;
  /** the quote token the coin will trade against; SOL when omitted */
  quoteMint?: string;
}

export interface RegisteredVault {
  address: string;
  floorLamports: string;
  basket: VaultBasketDoc[];
  quote: { mint: string; tokenProgram: string; decimals: number };
}

/**
 * Custodial mode's `create_vault`: validates the basket against the policy, registers the vault and returns its
 * address (a keypair only the keeper can reconstruct). No transaction, no rent. The caller then funds the wallet's
 * floor + token accounts and launches the coin on LaunchLab with this address as creator; the keeper binds it when
 * it sees the pool. Idempotent for the same (creator, salt).
 */
export async function registerCustodialVault(b: RegisterVaultInput): Promise<RegisteredVault> {
  if (!isCustodial) throw new LaunchInputError("not a custodial deployment", 404);
  if (!isBase58Address(b.creator ?? "") || !isBase58Address(b.expectedMint ?? "")) throw new LaunchInputError("invalid creator or mint");
  if (!/^\d{1,20}$/.test(String(b.salt ?? ""))) throw new LaunchInputError("invalid salt");
  if (!Array.isArray(b.legs) || b.legs.length === 0 || b.legs.length > 10 || b.legs.length !== b.weightsBps?.length) throw new LaunchInputError("invalid basket");
  const total = b.weightsBps.reduce((s, w) => s + Number(w), 0);
  if (total !== 10_000 || b.weightsBps.some((w) => !Number.isInteger(w) || w <= 0)) throw new LaunchInputError("weights must be whole bps summing to 10000");
  const { custodialConfig } = await import("../custody/config");
  const cfg = custodialConfig();
  if (cfg.paused) throw new LaunchInputError("launches are paused", 503);
  if (!Number.isInteger(b.epochLength) || b.epochLength < cfg.minEpochLength) throw new LaunchInputError(`period must be at least ${cfg.minEpochLength} seconds`);
  for (const leg of b.legs) {
    if (!isBase58Address(leg.mint) || !cfg.allowlist.includes(leg.mint)) throw new LaunchInputError(`${leg.mint} is not an allowed basket mint`);
  }
  const quoteMint = b.quoteMint ?? SOL_PAIR.mint;
  if (!isBase58Address(quoteMint)) throw new LaunchInputError("invalid quote mint");
  const quote = await findPair(quoteMint);
  if (!quote) throw new LaunchInputError("that quote token is not launchable right now", 400);
  const connection = serverConnection();
  const mints = b.legs.map((l) => l.mint);
  const infos = await connection.getMultipleAccountsInfo(mints.map((m) => new PublicKey(m)));
  const tokens = await ensureTokens([...mints, quote.mint], { kind: undefined });
  const basket = b.legs.map((l, i) => {
    const info = infos[i];
    if (!info) throw new Error(`${l.mint} not found on chain`);
    return { mint: l.mint, tokenProgram: info.owner.toBase58(), decimals: tokens.get(l.mint)?.decimals ?? 6, weightBps: b.weightsBps[i] };
  });
  const { createCustodialVault } = await import("../custody/ledger");
  const { vaultFloorLamports } = await import("../custody/keeper");
  const v = await createCustodialVault({
    creator: b.creator,
    salt: String(b.salt),
    basket,
    epochLength: b.epochLength,
    expectedMint: b.expectedMint,
    quote: { mint: quote.mint, tokenProgram: quote.tokenProgram, decimals: quote.decimals },
  });
  return {
    address: v.address,
    floorLamports: String(await vaultFloorLamports()),
    basket: v.basket,
    quote: { mint: v.quoteMint, tokenProgram: v.quoteTokenProgram ?? quote.tokenProgram, decimals: v.quoteDecimals ?? quote.decimals },
  };
}
