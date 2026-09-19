"use client";

import Image from "next/image";
import { useRef } from "react";
import { motion, useInView, useReducedMotion, useSpring } from "motion/react";
import { BrandMark } from "@/components/site/brand";
import { TokenIcon } from "@/components/token-icon";
import type { TokenJson } from "@/lib/api-types";

export function LaunchSculpture() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { margin: "80px" });
  const reduced = useReducedMotion();
  const rotateX = useSpring(0, { stiffness: 100, damping: 25 });
  const rotateY = useSpring(0, { stiffness: 100, damping: 25 });
  return (
    <div ref={ref} className="studio-sculpture" data-active={visible && !reduced}
      onPointerMove={event => {
        if (reduced || event.pointerType !== "mouse") return;
        const box = event.currentTarget.getBoundingClientRect();
        rotateY.set(((event.clientX - box.left) / box.width - .5) * 12);
        rotateX.set(-((event.clientY - box.top) / box.height - .5) * 9);
      }}
      onPointerLeave={() => { rotateX.set(0); rotateY.set(0); }}>
      <div className="studio-orbit orbit-back" aria-hidden="true" />
      <motion.div className="studio-object" style={{ rotateX, rotateY }}>
        <div className="studio-object-float">
          <Image src="/brand/launch-chain.png" alt="" width={1024} height={1024} sizes="(max-width: 800px) 85vw, 42vw" preload />
        </div>
      </motion.div>
      <div className="studio-orbit orbit-front" aria-hidden="true"><i /></div>
      <div className="studio-material-label"><span>01 / THE CONNECTION</span><span>One coin. More possibilities.</span></div>
    </div>
  );
}

export function CoinPreview({ name, symbol, logo, description, basket, epochLength }: {
  name: string; symbol: string; logo: string; description: string;
  basket: { token: TokenJson; weight: number }[]; epochLength: number;
}) {
  let imageSrc: string | null = null;
  try {
    const url = new URL(logo, "http://localhost");
    if ((/^https?:\/\//.test(logo) || /^\/(?!\/)/.test(logo)) && ["http:", "https:"].includes(url.protocol)) imageSrc = logo;
  } catch { /* An incomplete URL is normal while the user is typing. */ }
  return (
    <div className="studio-coin-preview">
      <div className="studio-preview-label"><span>Your market, taking shape</span><span className="studio-draft">Draft preview</span></div>
      <div className="studio-coin-heading">
        <div className="studio-coin-logo">
          {imageSrc ? <Image src={imageSrc} unoptimized width={64} height={64} alt="Your coin artwork" /> : <BrandMark size={44} />}
        </div>
        <div><h2>{name.trim() || "Something worth holding."}</h2><span>${symbol.trim().replace(/^\$/, "").toUpperCase() || "YOURCOIN"}</span></div>
      </div>
      <p className="studio-coin-story">{description.trim() || "Every great market starts with a point of view. Make this one yours."}</p>
      <div className="studio-reward-heading"><span>Stock rewards</span><span>{basket.length ? `${basket.length} selected` : "Your next connection"}</span></div>
      {basket.length ? <div className="studio-preview-assets">{basket.map(item => <motion.div layout key={item.token.mint} className="studio-preview-asset" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <TokenIcon symbol={item.token.symbol} address={item.token.mint} logoUrl={item.token.logoUrl} size={24} />
        <span>{item.token.symbol}</span><strong>{item.weight}%</strong>
      </motion.div>)}</div> : <div className="studio-reward-placeholder"><span /><span /><span /><p>Choose your basket in the next step.</p></div>}
      <div className="studio-preview-bottom"><span>Not launched yet</span><span>{basket.length ? `Payout period · ${epochLength / 86400 >= 1 ? `${epochLength / 86400} days` : `${epochLength / 3600} hours`}` : "Built on Solana"}</span></div>
    </div>
  );
}
