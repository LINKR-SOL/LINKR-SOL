import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction } from "@solana/spl-token";
import type { Program } from "@coral-xyz/anchor";
import type { CausaVault } from "./idl/causa_vault";
import { ata, bn, claimPda, configPda, epochPda, TOKEN_PROGRAM_ID, vaultPda, WSOL_MINT } from "./program";
import { launchpadPoolId } from "../launchlab/pool";
import { PROGRAM_ID } from "./cluster";

/**
 * Instruction builders shared by the browser (wallet-signed) and the keeper. Every builder takes the Anchor
 * program bound to whoever signs and returns plain instructions, so callers compose transactions freely.
 */

export const EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PROGRAM_ID)[0];

export interface BasketLeg {
  mint: PublicKey;
  tokenProgram: PublicKey;
}

/** Creates the vault's token accounts (client-paid, idempotent) and the vault itself. */
export async function createVaultIxs(
  program: Program<CausaVault>,
  p: { creator: PublicKey; salt: bigint; legs: BasketLeg[]; weightsBps: number[]; epochLength: number; expectedMint: PublicKey },
): Promise<{ instructions: TransactionInstruction[]; vault: PublicKey }> {
  const vault = vaultPda(p.creator, p.salt);
  const quoteAta = ata(vault, WSOL_MINT, TOKEN_PROGRAM_ID);
  const instructions: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(p.creator, quoteAta, vault, WSOL_MINT, TOKEN_PROGRAM_ID),
  ];
  const remaining: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  for (const leg of p.legs) {
    const legAta = ata(vault, leg.mint, leg.tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(p.creator, legAta, vault, leg.mint, leg.tokenProgram));
    remaining.push(
      { pubkey: leg.mint, isSigner: false, isWritable: false },
      { pubkey: PublicKey.findProgramAddressSync([Buffer.from("basket"), leg.mint.toBuffer()], PROGRAM_ID)[0], isSigner: false, isWritable: false },
      { pubkey: legAta, isSigner: false, isWritable: false },
    );
  }
  instructions.push(
    await program.methods
      .createVault({ salt: bn(p.salt), weightsBps: p.weightsBps, epochLength: p.epochLength, expectedMint: p.expectedMint })
      .accountsStrict({
        creator: p.creator, config: configPda(), vault, quoteMint: WSOL_MINT, vaultQuoteAta: quoteAta, quoteTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID,
      })
      .remainingAccounts(remaining)
      .instruction(),
  );
  return { instructions, vault };
}

/** Program mode: hands the LaunchLab pool (whose `creator` must be the vault) to `bind_launch`. */
export function bindLaunchIx(program: Program<CausaVault>, vault: PublicKey, mint: PublicKey, quote: PublicKey = WSOL_MINT): Promise<TransactionInstruction> {
  return program.methods.bindLaunch().accountsStrict({ vault, bondingCurve: launchpadPoolId(mint, quote), eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID }).instruction();
}

export function setAutoClaimIx(program: Program<CausaVault>, creator: PublicKey, vault: PublicKey, enabled: boolean): Promise<TransactionInstruction> {
  return program.methods.setAutoClaim(enabled).accountsStrict({ creator, vault, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID }).instruction();
}

export function cancelEpochIx(program: Program<CausaVault>, caller: PublicKey, vault: PublicKey, epochId: number): Promise<TransactionInstruction> {
  return program.methods
    .cancelEpoch()
    .accountsStrict({ caller, config: configPda(), vault, epoch: epochPda(vault, epochId), eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
    .instruction();
}

/**
 * The harvest intake sequence for a vault (creator or operator): `wrap_fees` (lamports on the PDA → its WSOL
 * ATA), a top-level `sync_native`, then `harvest_intake`. StonkFun forwards fees onto the PDA, so there is nothing to collect first.
 */
export async function harvestIntakeIx(
  program: Program<CausaVault>,
  p: { caller: PublicKey; vault: PublicKey; quoteMint: PublicKey; quoteTokenProgram: PublicKey; protocolRecipient: PublicKey; legs: BasketLeg[]; maxInput?: bigint },
): Promise<TransactionInstruction[]> {
  const protocolAta = ata(p.protocolRecipient, p.quoteMint, p.quoteTokenProgram);
  const vaultQuoteAta = ata(p.vault, p.quoteMint, p.quoteTokenProgram);
  return [
    await program.methods
      .wrapFees()
      .accountsStrict({ caller: p.caller, config: configPda(), vault: p.vault, quoteMint: p.quoteMint, vaultQuoteAta, quoteTokenProgram: p.quoteTokenProgram, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
      .instruction(),
    createSyncNativeInstruction(vaultQuoteAta, p.quoteTokenProgram),
    createAssociatedTokenAccountIdempotentInstruction(p.caller, protocolAta, p.protocolRecipient, p.quoteMint, p.quoteTokenProgram),
    await program.methods
      .harvestIntake(bn(p.maxInput ?? 0n))
      .accountsStrict({
        caller: p.caller, config: configPda(), vault: p.vault, quoteMint: p.quoteMint, vaultQuoteAta,
        protocolQuoteAta: protocolAta, quoteTokenProgram: p.quoteTokenProgram, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID,
      })
      .remainingAccounts(p.legs.map((l) => ({ pubkey: ata(p.vault, l.mint, l.tokenProgram), isSigner: false, isWritable: false })))
      .instruction(),
  ];
}

/** One epoch claim for `account`, paid by `payer`; creates the recipient token accounts as needed. */
export async function claimIxs(
  program: Program<CausaVault>,
  p: { payer: PublicKey; account: PublicKey; vault: PublicKey; epochId: number; amounts: bigint[]; proof: Uint8Array[]; legs: BasketLeg[] },
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  const remaining: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  p.amounts.forEach((a, i) => {
    if (a === 0n) return;
    const leg = p.legs[i];
    const holderAta = ata(p.account, leg.mint, leg.tokenProgram);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(p.payer, holderAta, p.account, leg.mint, leg.tokenProgram));
    remaining.push(
      { pubkey: leg.mint, isSigner: false, isWritable: false },
      { pubkey: ata(p.vault, leg.mint, leg.tokenProgram), isSigner: false, isWritable: true },
      { pubkey: holderAta, isSigner: false, isWritable: true },
      { pubkey: leg.tokenProgram, isSigner: false, isWritable: false },
    );
  });
  const epoch = epochPda(p.vault, p.epochId);
  ixs.push(
    await program.methods
      .claim({ epochId: bn(p.epochId), amounts: p.amounts.map(bn), proof: p.proof.map((x) => [...x]) })
      .accountsStrict({
        payer: p.payer, config: configPda(), vault: p.vault, epoch, account: p.account, claimStatus: claimPda(epoch, p.account),
        systemProgram: SystemProgram.programId, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID,
      })
      .remainingAccounts(remaining)
      .instruction(),
  );
  return ixs;
}

export { SYSVAR_INSTRUCTIONS_PUBKEY };
