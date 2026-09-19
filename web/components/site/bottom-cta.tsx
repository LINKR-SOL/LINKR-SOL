"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "@/components/ui/icons";
import { useReveal } from "./reveal";
import { BrandMark } from "./brand";

export function BottomCta() {
  const cta = useReveal<HTMLDivElement>({ stagger: true });
  return (
    <section className="bottom-cta">
      <div {...cta} className={`bottom-cta-inner ${cta.className}`}>
        <div className="cta-orbit">
          <span className="cta-core">
            <BrandMark size={18} />
          </span>
          <span className="cta-dot dot-a">
            <img alt="Nvidia" src="/nvidia.svg" />
          </span>
          <span className="cta-dot dot-b">
            <img alt="Tesla" src="/tesla.svg" />
          </span>
          <span className="cta-dot dot-c">
            <img alt="AMD" src="/amd.svg" />
          </span>
        </div>
        <span className="eyebrow">Ready to launch?</span>
        <h2>Back the idea. Not the ticker.</h2>
        <p>
          Launch on StonkFun and pair your coin to a whole basket of tokenised
          stocks — so being right about the narrative is enough.
        </p>
        <Link className="primary-button light-button" href={"/launch" as Route}>
          Launch a coin
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
