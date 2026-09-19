"use client";

import { useNow } from "@/lib/hooks/useNow";
import { formatRelative } from "@/lib/format";
import { cx } from "./primitives";

/**
 * A relative time that ticks every second on its own ("in 7 min 32 s" → "in 7 min 31 s" …), so the page's
 * coarser clock never makes a countdown look frozen. `past` is what to render once the target is reached.
 */
export function Relative({ target, past, className }: { target: number; past?: string; className?: string }) {
  const now = useNow(1_000);
  const text = past !== undefined && now >= target ? past : formatRelative(target, now);
  return (
    <span className={cx("num tabular-nums", className)} aria-live="off">
      {text}
    </span>
  );
}

/** "7 min 32 s" without the "in": for badges and parentheses that carry their own wording. */
export function Countdown({ target, done = "now", className }: { target: number; done?: string; className?: string }) {
  const now = useNow(1_000);
  const text = now >= target ? done : formatRelative(target, now).replace(/^in /, "");
  return (
    <span className={cx("num tabular-nums", className)} aria-live="off">
      {text}
    </span>
  );
}
