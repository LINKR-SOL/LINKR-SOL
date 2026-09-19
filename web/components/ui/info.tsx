"use client";

import { useId, useState, type ReactNode } from "react";
import { Info as InfoIcon } from "@/components/ui/icons";
import { cx } from "./primitives";

/**
 * The little "i" next to a term. Hover or focus shows the explanation; a click/tap pins it (touch has no
 * hover) and Escape or blur dismisses it. Pure CSS positioning, no portal: it sits inside the label so it
 * inherits nothing from the label's uppercase/tracking styles (the tip resets those).
 */
export function Info({
  children,
  label = "What does this mean?",
  side = "top",
  align = "center",
  className,
}: {
  children: ReactNode;
  label?: string;
  side?: "top" | "bottom";
  align?: "center" | "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={cx("info", className)} data-open={open || undefined} data-side={side} data-align={align}>
      <button
        type="button"
        className="info__btn"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <InfoIcon size={14} weight="regular" aria-hidden />
      </button>
      <span role="tooltip" id={id} className="info__tip">
        {children}
      </span>
    </span>
  );
}
