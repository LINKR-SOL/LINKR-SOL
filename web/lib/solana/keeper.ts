import { Keypair, type PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { envValue } from "./cluster";

/** The keeper's signing key: base58 secret key (Phantom export) or a JSON byte array (solana-keygen). */
export function keeperKeypair(): Keypair | null {
  const raw = envValue("KEEPER_PRIVATE_KEY");
  if (!raw) return null;
  if (raw.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

/** Anchor wallet adapter around a Keypair (server side). */
export class KeypairWallet implements Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("version" in tx) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    for (const tx of txs) await this.signTransaction(tx);
    return txs;
  }
}
