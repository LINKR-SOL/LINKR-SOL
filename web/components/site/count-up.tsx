"use client";

import { useEffect, useRef, useState } from "react";

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts a value up from its previous figure the first time it arrives.
 *
 *  Returns the live value untouched unless an animation is actually running,
 *  so nothing re-renders when the number is static, zero, or when the viewer
 *  has asked for reduced motion — a ticking number is exactly the kind of
 *  movement that setting exists to suppress.
 */
export function useCountUp(value: number, { duration = 900, enabled = true } = {}) {
  const [animated, setAnimated] = useState<number | null>(null);
  const animatedFor = useRef<number | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!enabled || !Number.isFinite(value) || value === 0) return;
    // Already counted to this figure; a refetch returning the same number
    // must not replay the animation.
    if (animatedFor.current === value) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    animatedFor.current = value;
    if (reduced) {
      last.current = value;
      return;
    }

    const from = last.current;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const current = from + (value - from) * EASE_OUT(t);
      last.current = current;
      setAnimated(t < 1 ? current : null);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, enabled, duration]);

  return animated ?? value;
}
