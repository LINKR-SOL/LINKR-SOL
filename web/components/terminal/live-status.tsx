"use client";

import { useEffect, useState } from "react";

/** Seconds since a timestamp, re-rendered once a second. */
export function useSecondsSince(timestamp: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!timestamp) return null;
  return Math.max(0, Math.floor((now - timestamp) / 1000));
}

export function agoLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Says what the data actually is: live, a cached copy after a failed refresh, or nothing
 * at all. A terminal that renders zeros when its feed is down is worse than one that
 * admits the feed is down, so every band on the page carries one of these.
 */
export function LiveStatus({
  fetchedAt,
  stale,
  error,
  empty,
  label = "Live",
  source,
}: {
  fetchedAt?: number;
  stale?: boolean;
  error?: string | null;
  empty?: boolean;
  label?: string;
  source?: string;
}) {
  const seconds = useSecondsSince(fetchedAt);
  const state = empty ? "down" : stale ? "stale" : "live";
  const text = state === "down" ? "Feed unavailable" : state === "stale" ? "Cached" : label;

  return (
    <span className={`live-status ${state}`} title={error ?? source ?? undefined}>
      <i />
      <strong>{text}</strong>
      {state !== "down" && <small>{agoLabel(seconds)}</small>}
    </span>
  );
}
