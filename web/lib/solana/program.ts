import { AnchorProvider, BorshCoder, EventParser, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import idlJson from "./idl/causa_vault.json";
import type { CausaVault } from "./idl/causa_vault";
import { PROGRAM_ID } from "./cluster";

export type { CausaVault };

/** The IDL with the program id of this deployment patched in (the build artifact carries the devnet id). */
export const IDL: CausaVault = { ...(idlJson as CausaVault), address: PROGRAM_ID.toBase58() as CausaVault["address"] };
export { PROGRAM_ID };

export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// DataView rather than Buffer.writeBigUInt64LE: the browser Buffer polyfill lacks the BigInt writers.
const u64le = (v: bigint | number | string) => {
  const b = Buffer.alloc(8);
  new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(v), true);
  return b;
};

// --- PDAs (must mirror programs/causa_vault/src/constants.rs) ---

export const configPda = () => PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
export const basketPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("basket"), mint.toBuffer()], PROGRAM_ID)[0];
export const vaultPda = (creator: PublicKey, salt: bigint | number | string) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault"), creator.toBuffer(), u64le(salt)], PROGRAM_ID)[0];
export const epochPda = (vault: PublicKey, epochId: bigint | number | string) =>
  PublicKey.findProgramAddressSync([Buffer.from("epoch"), vault.toBuffer(), u64le(epochId)], PROGRAM_ID)[0];
export const claimPda = (epoch: PublicKey, account: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("claim"), epoch.toBuffer(), account.toBuffer()], PROGRAM_ID)[0];

export function ata(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

// --- Program clients ---

/** Read-only program bound to a connection (server side: indexer, keeper, API routes). */
export function readonlyProgram(connection: Connection): Program<CausaVault> {
  const provider = new AnchorProvider(connection, NOOP_WALLET, { commitment: "confirmed" });
  return new Program<CausaVault>(IDL, provider);
}

/** Program bound to a signing wallet (browser via wallet-adapter, or the keeper's Keypair wallet). */
export function walletProgram(connection: Connection, wallet: Wallet): Program<CausaVault> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program<CausaVault>(IDL, provider);
}

export const coder = new BorshCoder(IDL as Idl);
export const eventParser = new EventParser(PROGRAM_ID, coder);

/** Instruction discriminators by name, for log/transaction decoding. */
export const IX_DISCRIMINATORS: Record<string, Buffer> = Object.fromEntries(
  (idlJson as { instructions: { name: string; discriminator: number[] }[] }).instructions.map((i) => [i.name, Buffer.from(i.discriminator)]),
);

const NOOP_WALLET: Wallet = {
  publicKey: PublicKey.default,
  signTransaction: async () => {
    throw new Error("read-only program");
  },
  signAllTransactions: async () => {
    throw new Error("read-only program");
  },
  payer: undefined as never,
};

export const bn = (v: bigint | number | string) => new BN(v.toString());
export const big = (v: BN | number | string) => BigInt(v.toString());
