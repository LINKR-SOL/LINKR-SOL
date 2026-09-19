"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/components/ui/toast";

/**
 * When a wallet connection stays in the "connecting" state for a while, the extension is almost always waiting
 * for approval in a popup window the user cannot see (macOS full-screen Spaces hide extension windows) or a
 * request is queued behind an earlier one. Surface that instead of leaving the spinner unexplained.
 */
export function ConnectHint() {
  const { connecting } = useWallet();
  const toast = useToast();
  const shown = useRef(false);

  useEffect(() => {
    if (!connecting) {
      shown.current = false;
      return;
    }
    const id = setTimeout(() => {
      if (shown.current) return;
      shown.current = true;
      toast.push({
        kind: "info",
        title: "Still waiting for your wallet",
        body:
          "The extension has opened an approval window. If you don't see it: exit full-screen (green button), check Mission Control, or click the wallet's toolbar icon to find the pending request.",
      });
    }, 8_000);
    return () => clearTimeout(id);
  }, [connecting, toast]);

  return null;
}
