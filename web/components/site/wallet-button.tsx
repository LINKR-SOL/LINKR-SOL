"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { shortAddress } from "@/lib/format";
import { activeCluster, clusterLabel } from "@/lib/solana/cluster";

/** Wallet-adapter connect flow rendered with the site's own pill buttons. */
export function WalletButton() {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className="wallet-connect-button wallet-connect-placeholder">Connect wallet</span>;
  if (!connected || !publicKey) {
    return (
      <button type="button" className="wallet-connect-button" onClick={() => setVisible(true)} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  return (
    <button type="button" className="wallet-account-button" onClick={() => disconnect()} title="Disconnect">
      <i />
      <strong>{shortAddress(publicKey.toBase58())}</strong>
      <span>{clusterLabel[activeCluster]}</span>
    </button>
  );
}
