"use client";

import { GlobeField } from "./globe-field";
import { usePulse } from "@/lib/hooks/useTerminal";
import { useReveal } from "./reveal";

/**
 * SECTION 10 — RELATION GRAPH, "Nothing moves alone."
 *
 * The pack asks for a relation graph rather than a decorative globe, and caps it
 * at "8–14 visible meaningful nodes". The venues are those nodes: a catalyst
 * lands on a listing venue and the arcs are where the reaction actually gets
 * traded. Figures are read live; nothing here is asserted.
 */
export function WorldBand() {
  const pulse = usePulse();
  const reveal = useReveal();

  const quotes = pulse.data?.stocks.quotes ?? [];
  const quoting = quotes.filter((q) => q.change24h !== null).length;
  const advancing = quotes.filter((q) => (q.change24h ?? 0) > 0).length;

  return (
    <section
      className="band band-ink world-band grain"
      data-canvas="ink"
      aria-labelledby="world-band-title"
    >
      <div {...reveal} className={`world-band-inner ${reveal.className}`}>
        <div className="world-copy">
          <span className="eyebrow-row">
            <i className="live-pip" aria-hidden="true" />
            <span className="eyebrow">Relation graph</span>
          </span>

          <h2 id="world-band-title" className="editorial">
            Nothing moves
            <br />
            <em>alone.</em>
          </h2>

          <p className="band-lede">
            A catalyst lands in one time zone and is priced in every other. The venues below
            are where the reaction is listed; the lines are where it gets traded.
          </p>

          <dl className="world-figures">
            <div>
              <dt>Reference assets quoting</dt>
              <dd className="num">{quoting || "—"}</dd>
            </div>
            <div>
              <dt>Advancing right now</dt>
              <dd className="num">{quoting ? `${advancing} / ${quoting}` : "—"}</dd>
            </div>
          </dl>

          <p className="world-hint">Drag the globe to rotate it.</p>
        </div>

        <GlobeField />
      </div>
    </section>
  );
}
