"use client";

import { useSyncExternalStore } from "react";

/** Wall-clock seconds, updated every `intervalMs`, safe to read during render (stable between ticks). */
export function useNow(intervalMs = 30_000): number {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs) * (intervalMs / 1000),
    () => 0,
  );
}
