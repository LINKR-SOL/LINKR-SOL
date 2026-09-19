"use client";

import { ArrowRight, Atom, RocketLaunch, StackSimple } from "@/components/ui/icons";
import { PairMark } from "./pair-mark";
import { TOKEN, TOKEN_IS_LIVE } from "@/lib/token";
import { useReveal } from "./reveal";
import { usePulse } from "@/lib/hooks/useTerminal";

/** Shown only until the live baskets load, so the ledger is never empty on first paint. */
const FALLBACK_LEDGER = ["NVDA", "AMD", "ETH"];

const STEPS = [
  {
    Icon: RocketLaunch,
    title: "Launch on StonkFun",
    body: "Your coin trades on StonkFun's bonding curve like any other, from our launch page.",
  },
  {
    Icon: Atom,
    title: "Pair it to a basket",
    body: "Name the idea, not the ticker: up to ten tokenised stocks, weighted however you like.",
  },
  {
    Icon: StackSimple,
    title: "Holders get the whole idea",
    body: "Creator fees buy the basket and reach every holder, with a 0% platform fee — no single name has to be the right one.",
  },
];

export function StoryBand() {
  const { data } = usePulse();
  const header = useReveal<HTMLDivElement>();
  const visual = useReveal<HTMLDivElement>();
  const steps = useReveal<HTMLDivElement>({ stagger: true });

  // Illustrate the ledger with a real basket — the one whose members are furthest apart
  // today — rather than three fixed tickers.
  const widest = [...(data?.narratives ?? [])]
    .filter((n) => n.spreadPct !== null)
    .sort((a, b) => (b.spreadPct as number) - (a.spreadPct as number))[0];
  const ledger = widest ? widest.members.slice(0, 5) : FALLBACK_LEDGER.map((symbol) => ({ symbol, change24h: null }));

  return (
    <section className="story-section" id="how">
      <div {...header} className={`story-header ${header.className}`}>
        <span className="section-kicker">From launch to payout</span>
        <h2>
          StonkFun runs the coin. <em>LINKR picks the basket.</em>
        </h2>
      </div>
      <div className="story-layout">
        <div {...visual} className={`story-visual ${visual.className}`}>
          <div className="story-visual-copy">
            <span>One coin, many stocks</span>
            <h3>A launch that holds a thesis, not a ticker.</h3>
            <p>
              The fees your coin already charges are claimed, swapped into every
              stock in the basket, and paid out to everyone holding it — whichever
              name in the idea turns out to be the winner.
            </p>
          </div>
          <div className="pair-ledger">
            <div className="pair-ledger-head">
              <span>{widest ? widest.name : "Reward basket"}</span>
              <em>{widest ? `${widest.size} stocks · every period` : "every period"}</em>
            </div>
            {ledger.map((row, i) => (
              <div className="pair-ledger-row" key={row.symbol}>
                <span className="ledger-index">{String(i + 1).padStart(2, "0")}</span>
                <span className="ledger-token">{`$${TOKEN.symbol}`}</span>
                <i>
                  <ArrowRight size={14} aria-hidden="true" />
                </i>
                <span className="ledger-pair">
                  <PairMark symbol={row.symbol} small /> {row.symbol}
                </span>
                <span className="ledger-status">
                  {row.change24h === null ? (
                    <>
                      <i /> In basket
                    </>
                  ) : (
                    <em className={row.change24h < 0 ? "down" : "up"}>
                      {row.change24h >= 0 ? "+" : ""}
                      {row.change24h.toFixed(2)}%
                    </em>
                  )}
                </span>
              </div>
            ))}
            <div className="pair-ledger-foot">
              <span>{widest ? "Live 24h moves" : TOKEN_IS_LIVE ? "Launched on StonkFun" : "Launching on StonkFun"}</span>
              <strong>
                {widest && widest.spreadPct !== null ? (
                  `${widest.spreadPct.toFixed(1)}pt spread`
                ) : (
                  <>
                    Fees
                    <ArrowRight size={12} className="inline align-[-1px] mx-1" aria-hidden="true" />
                    stocks
                  </>
                )}
              </strong>
            </div>
          </div>
        </div>
        <div {...steps} className={`story-steps ${steps.className}`}>
          {STEPS.map(({ Icon, title, body }) => (
            <article className="story-step" key={title}>
              <span>
                <Icon size={18} aria-hidden="true" />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
