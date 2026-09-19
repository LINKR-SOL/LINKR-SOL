"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { BrandMark } from "@/components/site/brand";
import { TokenIcon } from "@/components/token-icon";
import { ArrowRight, ArrowsClockwise } from "@/components/ui/icons";

const steps = [
  { title:"A coin with conviction.", label:"The trade", body:"Your idea becomes a coin. Trading activity on StonkFun generates fees — not a promise of returns." },
  { title:"Activity becomes opportunity.", label:"The fees", body:"The creator’s share of trading fees flows into the connected vault. No activity means no new fees." },
  { title:"Fees become real stock exposure.", label:"The stocks", body:"The vault converts received fees into the creator’s chosen basket of supported tokenised stocks." },
  { title:"The connection reaches holders.", label:"The holders", body:"Rewards are distributed according to how much each eligible wallet held, and for how long. Amounts vary." },
];
export function ConnectionEngine(){
  const ref=useRef<HTMLElement>(null);
  const visible=useInView(ref,{amount:.15});
  const reduced=useReducedMotion();
  const [active,setActive]=useState(0);
  const [manual,setManual]=useState(false);
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  const paused=hovered||focused;
  const {scrollYProgress}=useScroll({target:ref,offset:["start end","end start"]});
  useMotionValueEvent(scrollYProgress,"change",v=>{if(!manual&&!reduced&&visible&&!paused)setActive(Math.max(0,Math.min(3,Math.floor((v-.25)/.5*4))))});
  useEffect(()=>{if(!visible||reduced||manual||paused)return;const t=setInterval(()=>{if(!document.hidden)setActive(s=>(s+1)%4)},5000);return()=>clearInterval(t)},[visible,reduced,manual,paused]);
  return <section ref={ref} id="how-it-works" className="connection-engine" data-active={visible&&!reduced} data-step={active} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false)}}>
    <div className="engine-aurora"/><div className="engine-grid"/>
    <header className="engine-header"><div><span className="engine-eyebrow">02 / THE LINKR EFFECT</span><h2>Market energy.<br/><em>Connected to more.</em></h2></div><div><p>One idea sets it in motion.<br/>Here’s where the value goes.</p><button onClick={()=>{setManual(false);setActive(0)}} aria-label="Replay the connection mechanism"><ArrowsClockwise size={14}/> Replay the flow</button></div></header>
    <div className="engine-stage" aria-label="Illustrated flow: trading, fees, tokenised stocks, holder wallets">
      <svg className="engine-conduit" viewBox="0 0 1200 300" preserveAspectRatio="none" fill="none" aria-hidden="true"><defs><linearGradient id="engine-track"><stop stopColor="#096bff"/><stop offset=".5" stopColor="#58b5ff"/><stop offset="1" stopColor="#ff992d"/></linearGradient></defs><path className="engine-track" d="M75 148H260Q280 148 290 163L320 188Q337 203 365 203H524Q545 203 560 183L605 124Q619 104 641 104H800Q830 104 849 127L902 182Q919 202 950 202H1130"/><path className="engine-packet" d="M75 148H260Q280 148 290 163L320 188Q337 203 365 203H524Q545 203 560 183L605 124Q619 104 641 104H800Q830 104 849 127L902 182Q919 202 950 202H1130"/></svg>
      <div className={`engine-station station-trade ${active===0?"is-active":""}`}><div className="engine-station-halo"/><div className="engine-coin"><div className="engine-coin-edge"/><div className="engine-coin-face"><BrandMark size={76}/><span>YOUR COIN</span></div><span className="engine-coin-orbit"/></div><span className="engine-object-label">THE IDEA, IN MOTION</span></div>
      <div className={`engine-station station-fees ${active===1?"is-active":""}`}><div className="engine-station-halo"/><div className="engine-vault"><div className="engine-vault-back"/><div className="engine-vault-mid"/><div className="engine-vault-face"><span className="engine-vault-light"/><span className="engine-vault-label">LINKR</span><b>Fee vault</b><span className="engine-vault-slot"/><div className="engine-vault-flow"><i/><i/><i/></div><small>Received trading fees</small></div></div><span className="engine-object-label">VALUE FINDS ITS WAY</span></div>
      <div className={`engine-station station-stocks ${active===2?"is-active":""}`}><div className="engine-station-halo"/><div className="engine-stock-art"><Image src="/brand/hero-ai-stack.png" width={220} height={240} sizes="(max-width:600px) 45vw, 20vw" alt=""/><div className="engine-stock-chip stock-chip-one"><TokenIcon symbol="NVDA" size={28}/><span>NVIDIA</span></div><div className="engine-stock-chip stock-chip-two"><TokenIcon symbol="MSFT" size={26}/><span>Microsoft</span></div><div className="engine-stock-chip stock-chip-three"><TokenIcon symbol="AAPL" size={26}/><span>Apple</span></div></div><span className="engine-object-label">TOKENISED STOCKS · EXAMPLE BASKET</span></div>
      <div className={`engine-station station-holders ${active===3?"is-active":""}`}><div className="engine-station-halo"/><div className="engine-wallet"><div className="engine-wallet-back"/><div className="engine-wallet-front"><div><span className="engine-wallet-glyph"><i/><i/><i/></span><span>Holder wallet</span></div><div className="engine-wallet-assets"><TokenIcon symbol="NVDA" size={34}/><TokenIcon symbol="MSFT" size={34}/><TokenIcon symbol="AAPL" size={34}/></div><span className="engine-wallet-rule"/><b>Connected rewards.</b><small>Time-weighted distribution</small></div></div><span className="engine-object-label">THE VALUE COMES FULL CIRCLE</span></div>
    </div>
    <div className="engine-controls" role="tablist" aria-label="Explore the LINKR mechanism">{steps.map((step,i)=><button key={step.label} id={`engine-tab-${i}`} role="tab" aria-selected={active===i} aria-controls="engine-explanation" tabIndex={active===i?0:-1} onClick={()=>{setActive(i);setManual(true)}} onKeyDown={e=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(e.key)){e.preventDefault();const next=e.key==="Home"?0:e.key==="End"?3:(i+(e.key==="ArrowRight"?1:3))%4;setActive(next);setManual(true);document.getElementById(`engine-tab-${next}`)?.focus()}}}><span>0{i+1}</span><b>{step.label}</b><ArrowRight size={17}/></button>)}</div>
    <div className="engine-caption" role="tabpanel" id="engine-explanation" aria-labelledby={`engine-tab-${active}`}><AnimatePresence mode="wait"><motion.div key={active} initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}} transition={{duration:reduced?0:.25}}><h3>{steps[active].title}</h3><p>{steps[active].body}</p></motion.div></AnimatePresence><span>MECHANISM ILLUSTRATION<br/>NOT A LIVE PAYOUT</span></div>
  </section>;
}
