"use client";

import { useEffect } from "react";

/**
 * Browser-extension scripts (MetaMask's inpage.js multichain client, Phantom, …) run in the page context and
 * can throw unhandled rejections that have nothing to do with this app — e.g. MetaMask's
 * "Failed to connect to MetaMask / MetaMask extension not found" on localhost. Next.js's dev overlay would
 * otherwise present them as application errors. Swallow only rejections whose stack points at an extension.
 */
export function ExtensionErrorFilter() {
  useEffect(() => {
    const isExtensionError = (reason: unknown) => {
      const r = reason as { stack?: string; cause?: { stack?: string } } | undefined;
      const stack = `${r?.stack ?? ""}\n${r?.cause?.stack ?? ""}`;
      return /chrome-extension:\/\/|moz-extension:\/\/|safari-web-extension:\/\//.test(stack);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isExtensionError(e.reason)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const onError = (e: ErrorEvent) => {
      if (isExtensionError(e.error) || /chrome-extension:\/\//.test(e.filename ?? "")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    // capture phase so we run before the dev overlay's listeners
    window.addEventListener("unhandledrejection", onRejection, true);
    window.addEventListener("error", onError, true);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection, true);
      window.removeEventListener("error", onError, true);
    };
  }, []);
  return null;
}
