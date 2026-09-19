"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { actionMessage } from "@/lib/custody/auth";

/**
 * Custodial mode: creator and holder actions have no transaction to sign, so the wallet signs a short message
 * instead and the server acts on it. Returns the JSON body the route answered with, or throws its error.
 */
export function useSignedAction() {
  const { publicKey, signMessage } = useWallet();
  return useCallback(
    async <T = unknown>(url: string, action: string, target: string, extra: Record<string, unknown> = {}): Promise<T> => {
      if (!publicKey) throw new Error("Wallet not connected");
      if (!signMessage) throw new Error("This wallet cannot sign messages; try Phantom or Solflare");
      const message = actionMessage(action, target);
      const sig = await signMessage(new TextEncoder().encode(message));
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...extra, action, pubkey: publicKey.toBase58(), message, signature: bs58.encode(sig) }),
      });
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      return body;
    },
    [publicKey, signMessage],
  );
}
