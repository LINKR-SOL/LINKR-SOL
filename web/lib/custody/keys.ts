import { Keypair } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keeperKeypair } from "../solana/keeper";

/**
 * Custodial mode: a vault is a keypair only the keeper can reconstruct, derived from the keeper's secret plus
 * the same (creator, salt) pair that seeds the on-chain PDA in program mode. Nothing but KEEPER_PRIVATE_KEY has
 * to be backed up; the public key is what StonkFun records as the coin's creator.
 */
export function vaultKeypair(creator: string, salt: string): Keypair {
  const keeper = keeperKeypair();
  if (!keeper) throw new Error("KEEPER_PRIVATE_KEY not set");
  const seed = sha256(Buffer.concat([Buffer.from("causa-custodial-vault-v1"), Buffer.from(keeper.secretKey.subarray(0, 32)), Buffer.from(creator), Buffer.from(salt)]));
  return Keypair.fromSeed(seed);
}

export const vaultAddress = (creator: string, salt: string): string => vaultKeypair(creator, salt).publicKey.toBase58();
