"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Reveals an element once, the first time it scrolls into view.
 *
 *  Returns props to spread onto the element itself rather than rendering a
 *  wrapper, so it can be used on grid and table children without breaking
 *  their layout. Pair with `.reveal` (single element) or `.reveal-stagger`
 *  (container whose children cascade) in multi.css.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>({
  delay = 0,
  stagger = false,
}: { delay?: number; stagger?: boolean } = {}) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;

    // No observer (very old browsers, some embedded webviews): show it rather
    // than leave the content permanently hidden.
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }

    // An element already on screen at mount gets its callback on the next tick,
    // so above-the-fold content still plays its entrance without a rect check.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      // Fire slightly before the element is fully in view so the motion has
      // settled by the time it reaches comfortable reading position.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return {
    ref,
    className: stagger ? "reveal-stagger" : "reveal",
    "data-visible": visible,
    style: delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined,
  };
}

/** Wrapper form, for when an extra div is harmless. */
export function Reveal({
  children,
  delay = 0,
  stagger = false,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  stagger?: boolean;
  className?: string;
}) {
  const reveal = useReveal<HTMLDivElement>({ delay, stagger });
  return (
    <div {...reveal} className={[reveal.className, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
