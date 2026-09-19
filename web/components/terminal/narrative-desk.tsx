"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "@/components/ui/icons";
import { usePulse, type NarrativeLive } from "@/lib/hooks/useTerminal";
import { PairMark } from "@/components/site/pair-mark";
import { LiveStatus } from "./live-status";

const pct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

/** Horizontal position of a move within the basket's own range, for the dispersion rail. */
function railPosition(value: number, min: number, max: number) {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

function Basket({ narrative }: { narrative: NarrativeLive }) {
  const priced = useMemo(
    () =>
      narrative.members
        .filter((m) => m.change24h !== null)
        .sort((a, b) => (b.change24h as number) - (a.change24h as number)),
    [narrative],
  );

  const min = priced.length ? (priced[priced.length - 1].change24h as number) : 0;
  const max = priced.length ? (priced[0].change24h as number) : 0;

  return (
    <div className="desk-basket" style={{ ["--accent" as string]: narrative.accent }}>
      <div className="desk-basket-head">
        <div>
          <h3>{narrative.name}</h3>
          <p>{narrative.thesis}</p>
        </div>
        <span className="desk-size">
          {narrative.size} stocks
          <small>{narrative.pricedCount} priced live</small>
        </span>
      </div>

      {priced.length > 1 ? (
        <>
          <div className="desk-verdict">
            <div className="desk-verdict-cell">
              <span>Best today</span>
              <strong className="up">{narrative.best?.symbol}</strong>
              <em className="up">{pct(narrative.best?.change24h)}</em>
            </div>
            <div className="desk-verdict-cell">
              <span>Worst today</span>
              <strong className="down">{narrative.worst?.symbol}</strong>
              <em className="down">{pct(narrative.worst?.change24h)}</em>
            </div>
            <div className="desk-verdict-cell wide">
              <span>Gap between them</span>
              <strong>{narrative.spreadPct === null ? "—" : `${narrative.spreadPct.toFixed(1)} points`}</strong>
              <em>the cost of guessing wrong</em>
            </div>
            <div className="desk-verdict-cell">
              <span>Whole basket</span>
              <strong className={(narrative.basketChange24h ?? 0) < 0 ? "down" : "up"}>
                {pct(narrative.basketChange24h)}
              </strong>
              <em>equal weight</em>
            </div>
          </div>

          <div className="desk-rail" aria-hidden="true">
            <span className="desk-rail-line" />
            {priced.map((m) => (
              <i
                key={m.symbol}
                className={(m.change24h as number) < 0 ? "down" : "up"}
                style={{ left: `${railPosition(m.change24h as number, min, max)}%` }}
                title={`${m.symbol} ${pct(m.change24h)}`}
              />
            ))}
          </div>
          <p className="desk-dispersion">{narrative.dispersion}</p>
        </>
      ) : (
        <p className="desk-dispersion">
          Live quotes for this basket are not available right now, so no spread is shown.
        </p>
      )}

      <div className="desk-members">
        {(priced.length ? priced : narrative.members).map((m) => (
          <span className="desk-member" key={m.symbol}>
            <PairMark symbol={m.symbol} small logoUrl={m.logoUrl} />
            <strong>{m.symbol}</strong>
            <em className={m.change24h === null ? "flat" : m.change24h < 0 ? "down" : "up"}>
              {m.change24h === null ? "no quote" : pct(m.change24h, 1)}
            </em>
          </span>
        ))}
      </div>

      <div className="desk-cta">
        <Link href={"/launch" as Route} className="primary-button">
          Pair a coin to {narrative.name}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <small>One launch, {narrative.size} stocks. No pick required.</small>
      </div>
    </div>
  );
}

/**
 * The argument for a basket, made with today's prices.
 *
 * Each narrative is a real set of tokenised stocks; the spread shown is the live gap
 * between its best and worst name over 24h. That gap is the risk a single-asset pairing
 * takes and a basket does not — which is the whole reason to pair to an idea instead of
 * a ticker.
 */
export function NarrativeDesk() {
  const { data, isLoading } = usePulse();
  const narratives = useMemo(
    () => [...(data?.narratives ?? [])].sort((a, b) => (b.spreadPct ?? -1) - (a.spreadPct ?? -1)),
    [data],
  );
  const [selected, setSelected] = useState<string | null>(null);

  // Until the reader picks a basket, follow the widest live spread — the most convincing
  // example is whichever idea is actually pulling apart today. Deriving it rather than
  // storing it means the default keeps tracking the data as prices move.
  const active = narratives.find((n) => n.id === selected) ?? narratives[0];

  return (
    <section className="desk-section" id="narratives">
      <div className="desk-header">
        <div>
          <span className="section-kicker">Invest in the idea</span>
          <h2>
            You do not need to know <em>which one wins.</em>
          </h2>
          <p>
            Pick the thesis, not the ticker. Every basket below is a set of tokenised stocks (xStocks) trading on Solana
            today, ordered by how far apart their members moved in the last 24 hours.
          </p>
        </div>
        <LiveStatus
          fetchedAt={data?.stocks.fetchedAt}
          stale={data?.stocks.stale}
          empty={!isLoading && narratives.length === 0}
          label="Live quotes"
        />
      </div>

      {narratives.length === 0 ? (
        <p className="pulse-empty">
          {isLoading ? "Pricing the baskets…" : "Live stock quotes are unavailable, so no baskets are scored."}
        </p>
      ) : (
        <div className="desk-layout">
          <div className="desk-list" role="tablist" aria-label="Narrative baskets">
            {narratives.map((n) => (
              <button
                key={n.id}
                type="button"
                role="tab"
                aria-selected={active?.id === n.id}
                className={active?.id === n.id ? "active" : ""}
                style={{ ["--accent" as string]: n.accent }}
                onClick={() => setSelected(n.id)}
              >
                <span>
                  <strong>{n.name}</strong>
                  <small>{n.size} stocks</small>
                </span>
                <em>{n.spreadPct === null ? "—" : `${n.spreadPct.toFixed(1)}pt spread`}</em>
              </button>
            ))}
          </div>
          {active && <Basket narrative={active} />}
        </div>
      )}
    </section>
  );
}
