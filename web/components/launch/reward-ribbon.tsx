"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import { motion, LayoutGroup } from "motion/react";

/**
 * The reward ribbon — one 100% bar, one segment per asset, dividers you drag
 * to move weight between neighbours. Presentation and the drag only; the
 * parent owns the numbers, so the same ribbon serves the composer (tenths of a
 * percent) and the launch wizard (whole percents, which is what the vault
 * factory accepts).
 *
 * `onBalance(k, a, b)` is called with the new weights of the pair either side
 * of divider k; their sum is never changed, so a ribbon that starts at 100
 * stays at 100.
 */

export interface RibbonItem {
  key: string;
  label: string;
  sub?: string;
  mark: ReactNode;
  weight: number;
  color: string;
  base?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function RewardRibbon({
  items,
  onBalance,
  focus,
  onFocus,
  onRemove,
  step = 1,
  min = 1,
  format = (w) => `${Math.round(w)}`,
  over = false,
  ariaLabel = "Reward split",
}: {
  items: RibbonItem[];
  onBalance: (k: number, a: number, b: number) => void;
  focus?: string | null;
  onFocus?: (key: string | null) => void;
  onRemove?: (key: string) => void;
  /** Granularity of a drag/keypress, in percent. */
  step?: number;
  min?: number;
  format?: (w: number) => string;
  /** Highlight as a drop target. */
  over?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const quant = (v: number) => Math.round(v / step) * step;

  const rebalance = (k: number, delta: number) => {
    const a = items[k];
    const b = items[k + 1];
    if (!a || !b) return;
    const sum = a.weight + b.weight;
    const na = clamp(quant(a.weight + delta), min, sum - min);
    onBalance(k, na, sum - na);
  };

  const startDrag = (k: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    const a = items[k];
    const b = items[k + 1];
    if (!rect || !a || !b) return;
    e.preventDefault();
    const wa = a.weight;
    const sum = a.weight + b.weight;
    const x0 = e.clientX;
    setDragging(k);
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - x0) / rect.width) * 100;
      const na = clamp(quant(wa + d), min, sum - min);
      onBalance(k, na, sum - na);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <LayoutGroup>
      <div
        ref={ref}
        className={`mc-ribbon ${dragging !== null ? "is-dragging" : ""} ${over ? "is-over" : ""} ${items.length === 0 ? "is-empty" : ""}`}
        role="group"
        aria-label={ariaLabel}
      >
        {items.length === 0 && <span className="mc-ribbon-empty">Drop an asset here to start the split.</span>}
        {items.map((it, i) => (
          <Fragment key={it.key}>
            <motion.div
              layout
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
              className={`mc-seg ${it.base ? "is-base" : ""} ${focus === it.key ? "is-focus" : ""}`}
              style={{ flexBasis: `${it.weight}%`, ["--seg" as string]: it.color }}
              onClick={() => onFocus?.(focus === it.key ? null : it.key)}
              role="button"
              tabIndex={0}
              aria-label={`${it.label} ${format(it.weight)} percent`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onFocus?.(focus === it.key ? null : it.key);
                }
                if ((e.key === "Backspace" || e.key === "Delete") && !it.base) onRemove?.(it.key);
              }}
            >
              <span className="mc-seg-mark">{it.mark}</span>
              <span className="mc-seg-text">
                <b>{it.label}</b>
                <small className="num">{format(it.weight)}%</small>
              </span>
            </motion.div>

            {i < items.length - 1 && (
              <button
                type="button"
                className={`mc-divider ${dragging === i ? "is-active" : ""}`}
                role="slider"
                aria-label={`Balance ${it.label} against ${items[i + 1].label}`}
                aria-valuemin={min}
                aria-valuemax={100}
                aria-valuenow={Math.round(it.weight)}
                aria-valuetext={`${it.label} ${format(it.weight)} percent, ${items[i + 1].label} ${format(items[i + 1].weight)} percent`}
                onPointerDown={startDrag(i)}
                onKeyDown={(e) => {
                  const big = e.shiftKey ? 5 : step;
                  if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    rebalance(i, big);
                  }
                  if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    rebalance(i, -big);
                  }
                }}
              >
                <i />
              </button>
            )}
          </Fragment>
        ))}
      </div>
    </LayoutGroup>
  );
}
