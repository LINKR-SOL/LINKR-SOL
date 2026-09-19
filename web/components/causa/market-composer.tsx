"use client";

import Link from "next/link";
import type { Route } from "next";
import { Fragment, useMemo, useRef, useState } from "react";
import { motion, LayoutGroup } from "motion/react";
import { ArrowRight, ArrowUpRight, X } from "@/components/ui/icons";
import { markColor } from "@/lib/marks";
import { usePulse } from "@/lib/hooks/useTerminal";
import { PairMark } from "@/components/site/pair-mark";
import { BrandMark } from "@/components/site/brand";
import { COIN_URL, TOKEN, TOKEN_IS_LIVE, tokenAddressShort } from "@/lib/token";

/**
 * The market composer — the product, directly under the hero.
 *
 * Same job as the original builder: your StonkFun coin, up to ten reward assets,
 * a weight for each, a whole thesis loadable in one click, and Launch. The
 * interaction model is different:
 *
 *   The ribbon   — one 100% bar. Every asset is a segment; drag the divider
 *                  between two segments to rebalance them. The total is always
 *                  100 by construction, so there is no over/under state to fix.
 *   The shelf    — the assets on offer. Click one, or drag it onto the ribbon,
 *                  to add it; it takes an even share and everything else
 *                  scales down proportionally, so custom weights survive.
 *   The rail     — the theses. Each row shows the basket's live 24h move and
 *                  its best-to-worst spread, read from the wire.
 *   The reaction — what the basket did today, weighted the way you weighted it.
 *
 * Weights are kept as floats and only rounded for display, so repeated drags
 * never drift the sum away from 100.
 */

const BASE = TOKEN.symbol;
const MAX_PAIRS = 10;
const MIN_W = 1;

/** Shown until live quotes arrive, so the shelf is never empty on first paint. */
const FALLBACK = ["NVDA", "AMD", "SOL", "SPY", "TSLA", "AAPL", "META"];
const DEFAULT_PAIRS = ["NVDA", "AMD", "SOL"];

const CRYPTO = new Set(["SOL", "WSOL"]);
const INDEX = new Set(["SPY", "QQQ", "SMH", "SOXX", "XLK", "VTI", "GLD", "SLV", "BND", "SCHD"]);
const kindOf = (s: string) => (CRYPTO.has(s) ? "Token" : INDEX.has(s) ? "Index" : "Stock");

type Weights = Record<string, number>;

function even(keys: string[]): Weights {
  const w: Weights = {};
  keys.forEach((k) => (w[k] = 100 / keys.length));
  return w;
}

/** New asset takes an even share; everyone else scales to make room. */
function addShare(w: Weights, keys: string[], sym: string): Weights {
  const share = 100 / (keys.length + 1);
  const out: Weights = {};
  keys.forEach((k) => (out[k] = w[k] * (1 - share / 100)));
  out[sym] = share;
  return out;
}

/** Removed asset's share is handed back proportionally. */
function dropShare(w: Weights, keys: string[], sym: string): Weights {
  const rest = keys.filter((k) => k !== sym);
  const sum = rest.reduce((s, k) => s + w[k], 0) || 1;
  const out: Weights = {};
  rest.forEach((k) => (out[k] = (w[k] / sum) * 100));
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pct = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? `${Math.round(v)}` : v.toFixed(1));

function Move({ v, big }: { v: number | null | undefined; big?: boolean }) {
  if (v === null || v === undefined) return <span className={`mc-move is-flat ${big ? "is-big" : ""}`}>—</span>;
  return (
    <span className={`mc-move ${v < 0 ? "is-neg" : "is-pos"} ${big ? "is-big" : ""} num`}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(2)}%
    </span>
  );
}

export function MarketComposer() {
  const { data } = usePulse();
  const [pairs, setPairs] = useState<string[]>(DEFAULT_PAIRS);
  const [weights, setWeights] = useState<Weights>(() => even([BASE, ...DEFAULT_PAIRS]));
  const [loaded, setLoaded] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState(false);

  /** Is a page-space point inside the ribbon? Geometric, so it works while the
   *  dragged chip itself is what sits under the pointer. */
  const overRibbon = (px: number, py: number) => {
    const r = ribbonRef.current?.getBoundingClientRect();
    if (!r) return false;
    const x = px - window.scrollX;
    const y = py - window.scrollY;
    return x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12;
  };
  const ribbonRef = useRef<HTMLDivElement>(null);
  /** Set while a chip is being dragged, so the tap that follows a drop is ignored. */
  const dragged = useRef(false);

  const quotes = data?.stocks.quotes ?? [];
  const moves = useMemo(() => new Map(quotes.map((q) => [q.symbol, q.change24h])), [quotes]);
  const logos = useMemo(() => new Map(quotes.map((q) => [q.symbol, q.logoUrl])), [quotes]);
  const names = useMemo(() => new Map(quotes.map((q) => [q.symbol, q.name])), [quotes]);

  /** Deepest-traded stocks plus SOL — every one of them is actually buyable. */
  const shelf = useMemo(() => {
    const live = quotes.slice(0, 12).map((q) => q.symbol);
    const symbols = live.length ? ["SOL", ...live.filter((s) => s !== "SOL")] : FALLBACK;
    return [...new Set([...DEFAULT_PAIRS, ...symbols])].slice(0, 14);
  }, [quotes]);

  const narratives = data?.narratives ?? [];
  const rows = useMemo(() => [BASE, ...pairs], [pairs]);
  const full = pairs.length >= MAX_PAIRS;

  /* ---- basket edits ------------------------------------------------------ */
  function add(sym: string) {
    if (pairs.includes(sym) || full) return;
    setWeights((w) => (w[sym] !== undefined ? w : addShare(w, rows, sym)));
    setPairs((p) => (p.includes(sym) || p.length >= MAX_PAIRS ? p : [...p, sym]));
    setLoaded(null);
    setFocus(sym);
  }
  function remove(sym: string) {
    if (sym === BASE || !pairs.includes(sym)) return;
    setWeights((w) => dropShare(w, rows, sym));
    setPairs((p) => p.filter((s) => s !== sym));
    setLoaded(null);
    setFocus(null);
  }
  function loadThesis(id: string) {
    const n = narratives.find((x) => x.id === id);
    if (!n) return;
    const next = n.members.map((m) => m.symbol).slice(0, MAX_PAIRS);
    setPairs(next);
    setWeights(even([BASE, ...next]));
    setLoaded(id);
    setFocus(null);
  }
  function rebalance(k: number, delta: number) {
    const a = rows[k];
    const b = rows[k + 1];
    setWeights((w) => {
      const na = clamp(w[a] + delta, MIN_W, w[a] + w[b] - MIN_W);
      return { ...w, [a]: na, [b]: w[a] + w[b] - na };
    });
    setLoaded(null);
  }

  /* ---- divider drag ------------------------------------------------------ */
  function startDrag(k: number) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      const rect = ribbonRef.current?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      const a = rows[k];
      const b = rows[k + 1];
      const wa = weights[a];
      const wb = weights[b];
      const x0 = e.clientX;
      setDragging(k);
      const move = (ev: PointerEvent) => {
        const d = ((ev.clientX - x0) / rect.width) * 100;
        const na = clamp(wa + d, MIN_W, wa + wb - MIN_W);
        setWeights((w) => ({ ...w, [a]: na, [b]: wa + wb - na }));
        setLoaded(null);
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
  }

  /* ---- reaction: the basket's day, weighted the way it is weighted ------- */
  const reaction = useMemo(() => {
    const priced = pairs.filter((s) => moves.get(s) !== null && moves.get(s) !== undefined);
    if (!priced.length) return { move: null as number | null, best: null as string | null, worst: null as string | null, priced: 0 };
    const sum = priced.reduce((s, k) => s + weights[k], 0) || 1;
    const move = priced.reduce((s, k) => s + (weights[k] / sum) * (moves.get(k) as number), 0);
    const sorted = [...priced].sort((x, y) => (moves.get(y) as number) - (moves.get(x) as number));
    return { move, best: sorted[0], worst: sorted[sorted.length - 1], priced: priced.length };
  }, [pairs, weights, moves]);

  const focusSym = focus && rows.includes(focus) ? focus : null;
  const activeThesis = narratives.find((n) => n.id === loaded) ?? null;

  return (
    <section className="mc" aria-labelledby="mc-title">
      <div className="mc-inner">
        {/* ---------------------------------------------------- the rail */}
        <aside className="mc-rail">
          <span className="eyebrow">Load a thesis</span>
          <ul className="mc-theses">
            {narratives.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={loaded === n.id ? "is-active" : ""}
                  style={{ ["--accent" as string]: n.accent }}
                  onClick={() => loadThesis(n.id)}
                  aria-pressed={loaded === n.id}
                >
                  <i className="mc-thesis-dot" />
                  <span className="mc-thesis-name">
                    <b>{n.name}</b>
                    <small>
                      <span className="num">{Math.min(n.size, MAX_PAIRS)}</span> assets
                      {" · "}
                      <Move v={n.basketChange24h} />
                      {n.spreadPct !== null && (
                        <>
                          {" · "}
                          <span className="num">{n.spreadPct.toFixed(1)}pt</span> spread
                        </>
                      )}
                    </small>
                  </span>
                </button>
              </li>
            ))}
            {narratives.length === 0 && <li className="mc-thesis-empty">Reading the wire…</li>}
          </ul>
          {activeThesis && <p className="mc-thesis-copy">{activeThesis.thesis}</p>}
        </aside>

        {/* ---------------------------------------------------- the ribbon */}
        <div className="mc-main">
          <header className="mc-head">
            <div>
              <span className="eyebrow">Reward split</span>
              <h2 id="mc-title" className="editorial">
                Pay holders in <em>{pairs.length}</em> {pairs.length === 1 ? "asset" : "assets"}.
              </h2>
            </div>
            <p>Drag a divider to rebalance. Drop an asset from the shelf to add it.</p>
          </header>

          <LayoutGroup>
            <div
              ref={ribbonRef}
              className={`mc-ribbon ${dragging !== null ? "is-dragging" : ""} ${over ? "is-over" : ""}`}
              role="group"
              aria-label="Reward split"
            >
              {rows.map((s, i) => {
                const isBase = s === BASE;
                const w = weights[s] ?? 0;
                return (
                  <Fragment key={s}>
                    <motion.div
                      layout
                      transition={{ type: "spring", stiffness: 420, damping: 38 }}
                      className={`mc-seg ${isBase ? "is-base" : ""} ${focusSym === s ? "is-focus" : ""}`}
                      style={{ flexBasis: `${w}%`, ["--seg" as string]: isBase ? "#f25a38" : markColor(s) }}
                      onClick={() => setFocus(focusSym === s ? null : s)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${s} ${pct(w)} percent`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setFocus(focusSym === s ? null : s);
                        }
                        if ((e.key === "Backspace" || e.key === "Delete") && !isBase) remove(s);
                      }}
                    >
                      <span className="mc-seg-mark">
                        {isBase ? <BrandMark size={14} /> : <PairMark symbol={s} small logoUrl={logos.get(s) ?? undefined} />}
                      </span>
                      <span className="mc-seg-text">
                        <b>{isBase ? `$${s}` : s}</b>
                        <small className="num">{pct(w)}%</small>
                      </span>
                    </motion.div>

                    {i < rows.length - 1 && (
                      <button
                        type="button"
                        className={`mc-divider ${dragging === i ? "is-active" : ""}`}
                        role="slider"
                        aria-label={`Balance ${s} against ${rows[i + 1]}`}
                        aria-valuemin={MIN_W}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(w)}
                        aria-valuetext={`${s} ${pct(w)} percent, ${rows[i + 1]} ${pct(weights[rows[i + 1]] ?? 0)} percent`}
                        onPointerDown={startDrag(i)}
                        onKeyDown={(e) => {
                          const step = e.shiftKey ? 5 : 0.5;
                          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                            e.preventDefault();
                            rebalance(i, step);
                          }
                          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                            e.preventDefault();
                            rebalance(i, -step);
                          }
                        }}
                      >
                        <i />
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </LayoutGroup>

          {/* Focused segment detail */}
          <div className="mc-detail" aria-live="polite">
            {focusSym ? (
              <>
                <span className="mc-detail-mark">
                  {focusSym === BASE ? <BrandMark size={18} /> : <PairMark symbol={focusSym} small logoUrl={logos.get(focusSym) ?? undefined} />}
                </span>
                <span className="mc-detail-text">
                  <b>{focusSym === BASE ? TOKEN.name : names.get(focusSym) ?? focusSym}</b>
                  <small>
                    {focusSym === BASE ? "Your StonkFun coin" : `${kindOf(focusSym)} reward`} · <span className="num">{pct(weights[focusSym] ?? 0)}%</span> of every payout
                  </small>
                </span>
                {focusSym !== BASE && <Move v={moves.get(focusSym)} />}
                {focusSym !== BASE && (
                  <button type="button" className="mc-remove" onClick={() => remove(focusSym)} aria-label={`Remove ${focusSym}`}>
                    <X size={12} weight="bold" />
                    Remove
                  </button>
                )}
              </>
            ) : (
              <span className="mc-detail-hint">Select a segment for details · Backspace removes it</span>
            )}
          </div>

          {/* ---------------------------------------------------- the shelf */}
          <div
            className="mc-shelf"
            onPointerEnter={() => dragging === null && setOver(false)}
          >
            <span className="eyebrow">
              Assets <em className="num">{pairs.length} / {MAX_PAIRS}</em>
            </span>
            <div className="mc-shelf-row">
              {shelf.map((s) => {
                const inBasket = pairs.includes(s);
                return (
                  <motion.button
                    key={s}
                    type="button"
                    className={`mc-chip ${inBasket ? "is-in" : ""} ${full && !inBasket ? "is-full" : ""}`}
                    drag={!inBasket && !full}
                    dragSnapToOrigin
                    dragMomentum={false}
                    dragElastic={0.12}
                    whileDrag={{ scale: 1.08, zIndex: 20 }}
                    whileTap={{ scale: 0.96 }}
                    onDragStart={() => (dragged.current = true)}
                    onDrag={(_, info) => setOver(overRibbon(info.point.x, info.point.y))}
                    onDragEnd={(_, info) => {
                      setOver(false);
                      if (overRibbon(info.point.x, info.point.y)) add(s);
                      window.setTimeout(() => (dragged.current = false), 0);
                    }}
                    onTap={() => {
                      if (dragged.current) return;
                      if (inBasket) remove(s);
                      else add(s);
                    }}
                    aria-pressed={inBasket}
                    aria-label={`${inBasket ? "Remove" : "Add"} ${s}`}
                    disabled={full && !inBasket}
                  >
                    <PairMark symbol={s} small logoUrl={logos.get(s) ?? undefined} />
                    <span>
                      <b>{s}</b>
                      <Move v={moves.get(s)} />
                    </span>
                  </motion.button>
                );
              })}
              <Link href={"/launch" as Route} className="mc-chip mc-chip-more" aria-label="All assets">
                <b>All assets</b>
                <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------- the reaction */}
        <aside className="mc-side">
          <a
            className="mc-base"
            href={TOKEN_IS_LIVE ? COIN_URL : undefined}
            target={TOKEN_IS_LIVE ? "_blank" : undefined}
            rel={TOKEN_IS_LIVE ? "noreferrer" : undefined}
            aria-disabled={TOKEN_IS_LIVE ? undefined : true}
            aria-label={TOKEN_IS_LIVE ? `Buy $${BASE} on StonkFun` : `$${BASE} has not launched yet`}
          >
            <i className="mc-base-mark">
              <BrandMark size={22} />
            </i>
            <span>
              <small className={TOKEN_IS_LIVE ? "is-live" : ""}>{TOKEN_IS_LIVE ? "Launched on StonkFun" : "Launching on StonkFun"}</small>
              <b>
                {TOKEN.name} <em className="num">${BASE}</em>
              </b>
              <code className="num">{tokenAddressShort}</code>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>

          <div className="mc-reaction">
            <span className="eyebrow">Basket reaction · 24h</span>
            <Move v={reaction.move} big />
            <dl>
              <div>
                <dt>Best</dt>
                <dd>
                  {reaction.best ? (
                    <>
                      <b>{reaction.best}</b> <Move v={moves.get(reaction.best)} />
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Worst</dt>
                <dd>
                  {reaction.worst ? (
                    <>
                      <b>{reaction.worst}</b> <Move v={moves.get(reaction.worst)} />
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Priced</dt>
                <dd className="num">
                  {reaction.priced} / {pairs.length}
                </dd>
              </div>
            </dl>
            <p>
              {reaction.move === null
                ? "The reaction appears once the basket's members are priced."
                : "What a holder's payout basket did today, weighted the way you weighted it."}
            </p>
          </div>

          <Link href={"/launch" as Route} className="btn-signal mc-launch">
            Create Market
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <span className="mc-foot">
            <i /> Solana · settled onchain
          </span>
        </aside>
      </div>
    </section>
  );
}
