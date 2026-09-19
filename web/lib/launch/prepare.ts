import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { ata } from "../solana/program";

/**
 * The custodial launch's first transaction, "Prepare dividend vault": the creator's wallet funds the vault's rent
 * floor and opens its token accounts — one per basket stock, plus the quote account StonkFun forwards the
 * creator's fee share into (wrapped SOL for SOL-quoted coins), which has to exist before the first fee arrives.
 * Shared by the web wizard (signed by the connected wallet) and the Telegram bot (signed by the bot wallet).
 */
export function prepareVaultIxs(p: {
  payer: PublicKey;
  vault: PublicKey;
  /** lamports to top the vault up by; 0 skips the transfer (a retry, when the floor is already there) */
  floorLamports: bigint;
  basket: { mint: string; tokenProgram: string }[];
  quote: { mint: string; tokenProgram: string } | null;
}): TransactionInstruction[] {
  const instructions: TransactionInstruction[] = [];
  if (p.floorLamports > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: p.payer, toPubkey: p.vault, lamports: p.floorLamports }));
  const accounts = [...p.basket, ...(p.quote ? [p.quote] : [])];
  for (const a of accounts) {
    const mint = new PublicKey(a.mint);
    const tp = new PublicKey(a.tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(p.payer, ata(p.vault, mint, tp), p.vault, mint, tp));
  }
  return instructions;
}
