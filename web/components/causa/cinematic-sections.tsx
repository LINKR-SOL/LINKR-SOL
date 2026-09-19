"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "@/components/ui/icons";
import { CinematicPlate } from "./cinematic-plate";
import { useReveal } from "@/components/site/reveal";

/**
 * The three ink bands. Each one sets data-canvas="ink", which re-points every
 * semantic token in theme.css — so nothing inside needs a dark: variant.
 *
 * These are the QUIET beats in the page rhythm (01_BRAND_SYSTEM §13). They carry
 * one statement and one plate each, and deliberately hold no data.
 */

/** SECTION 03 — INFORMATION BEFORE PRICE. The brand-defining scene. */
export function InformationBeforePrice() {
  const r = useReveal<HTMLDivElement>();
  return (
    <section className="band band-ink grain" data-canvas="ink" aria-labelledby="ibp-title">
      <CinematicPlate name="causalline" className="plate-bleed" />
      <div className="band-scrim" />
      <div {...r} className={`band-inner band-tall ${r.className}`}>
        <span className="eyebrow">The edge is context</span>
        <h2 id="ibp-title" className="editorial">
          Information moves
          <br />
          <em>before price does.</em>
        </h2>
        <p className="band-lede">
          We close the distance between what happens and what becomes tradable.
        </p>
      </div>
    </section>
  );
}

/** SECTION 11 — BRAND CINEMATIC. "This section should slow the experience down." */
export function ConsensusBand() {
  const r = useReveal<HTMLDivElement>();
  return (
    <section className="band band-ink grain" data-canvas="ink" aria-labelledby="consensus-title">
      <CinematicPlate name="consensuswave" className="plate-bleed" />
      <div className="band-scrim band-scrim-left" />
      <div {...r} className={`band-inner band-tall band-left ${r.className}`}>
        <h2 id="consensus-title" className="editorial">
          Consensus is expensive.
          <br />
          <em>Being early isn&rsquo;t.</em>
        </h2>
        <p className="band-lede">
          Built for people who notice the shift before everyone starts talking about it.
        </p>
        <ol className="stage-line" aria-label="From signal to market">
          <li>Signal</li>
          <li>Context</li>
          <li>Conviction</li>
          <li>Market</li>
        </ol>
      </div>
    </section>
  );
}

/** SECTION 18 — FINAL CTA. */
export function FinalCta() {
  const r = useReveal<HTMLDivElement>();
  return (
    <section className="band band-ink band-cta grain" data-canvas="ink" aria-labelledby="final-cta-title">
      <CinematicPlate name="herolandscape" className="plate-bleed plate-dim" />
      <div className="band-scrim" />
      <div {...r} className={`band-inner ${r.className}`}>
        <h2 id="final-cta-title" className="editorial">
          Trade the <em>Cause.</em>
        </h2>
        <p className="band-lede">Discover what is moving markets now.</p>
        <div className="band-actions">
          <Link className="btn-signal" href={"/news" as Route}>
            Enter LINKR
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link className="btn-quiet" href={"/launch" as Route}>
            Create Market
          </Link>
        </div>
      </div>
    </section>
  );
}
