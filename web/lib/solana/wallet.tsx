"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { publicRpcUrl } from "./cluster";

/**
 * Wallet-standard wallets (Phantom, Solflare, Backpack, …) register themselves, so the adapter list stays
 * empty on purpose: anything installed shows up in the modal without us shipping per-wallet adapters.
 */
export function SolanaProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={publicRpcUrl} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
