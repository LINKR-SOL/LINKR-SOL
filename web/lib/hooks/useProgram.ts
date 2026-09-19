"use client";

import { useMemo } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IDL, type CausaVault } from "@/lib/solana/program";

const READ_ONLY = {
  publicKey: PublicKey.default,
  signTransaction: async () => {
    throw new Error("connect a wallet first");
  },
  signAllTransactions: async () => {
    throw new Error("connect a wallet first");
  },
};

/** The causa_vault program bound to the connected wallet (read-only until one connects). */
export function useProgram(): Program<CausaVault> {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => {
    const provider = new AnchorProvider(connection, wallet ?? READ_ONLY, { commitment: "confirmed" });
    return new Program<CausaVault>(IDL, provider);
  }, [connection, wallet]);
}
