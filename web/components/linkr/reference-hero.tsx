"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, useSpring } from "motion/react";
import { useNews } from "@/lib/hooks/useNews";
import type { NewsItem } from "@/lib/news/types";
import { ArrowRight, ArrowUpRight, ArrowsClockwise } from "@/components/ui/icons";
import { TokenIcon } from "@/components/token-icon";
import { MotionSurface } from "./motion";
import { HeroVolume } from "./hero-volume";
import { ContractAddress } from "./contract-address";

const themes = [
  { name:"The AI Stack", sub:"Compute. Models. A more open future.", image:"/brand/hero-ai-stack.png", tickers:["NVDA","AMD","MSFT"], className:"ai" },
  { name:"American Defense", sub:"The next generation of aerospace.", image:"/brand/hero-defense.png", tickers:["LMT","RTX","NOC"], className:"defense" },
  { name:"Musk Economy", sub:"People. Products. A bolder tomorrow.", image:"/brand/hero-space.png", tickers:["TSLA","SPCX"], className:"space" },
];
const stamp = (value:string) => new Date(value).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});
export function StoryArt({item}:{item?:NewsItem}) {
  const theme = item?.tickers.some(t => ["TSLA","SPCX","RKLB"].includes(t)) ? themes[2] : item?.tickers.some(t => ["LMT","RTX","NOC"].includes(t)) ? themes[1] : themes[0];
  return <div className="story-art editorial-story-art">
    {/* Provider images may be served by any publication; local decorative artwork uses the same frame. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={item?.imageUrl || theme.image} alt={item?.imageUrl ? "" : "Thematic illustration"} loading="lazy"/>
    {!item?.imageUrl && <small>Concept artwork</small>}
  </div>;
}
function Chips({tickers}:{tickers:string[]}) { return <div className="ref-tickers">{tickers.map(symbol => <span key={symbol}><TokenIcon symbol={symbol} size={27}/><b>{symbol}</b></span>)}</div>; }
function Connections(){return <svg className="ref-connections" viewBox="0 0 900 650" fill="none" preserveAspectRatio="none" aria-hidden="true"><path d="M10 355L165 296V84Q165 62 191 59L520 25Q551 22 551 51V117L841 337Q870 358 870 386V460"/><path d="M45 463L217 598L564 634Q590 637 602 607L656 463L812 504"/><path d="M250 56L245 190L548 326L679 201L790 178"/><path className="ref-signal" d="M10 355L165 296V84Q165 62 191 59L520 25Q551 22 551 51V117L841 337Q870 358 870 386V460"/>{[[10,355],[551,117],[870,460],[602,607]].map(([cx,cy])=><circle key={cx} cx={cx} cy={cy} r="8" fill="#ff8a0a"/>)}{[[245,190],[548,326],[217,598]].map(([cx,cy])=><circle key={cx} cx={cx} cy={cy} r="9" fill="#0066ff"/>)}</svg>}
export function Hero(){
  const news = useNews({limit:5});
  const items = news.data?.preview ? [] : news.data?.data?.items ?? [];
  const [index,setIndex] = useState(0);
  const [hover,setHover] = useState(false);
  const [focused,setFocused] = useState(false);
  const [manual,setManual] = useState(false);
  const reduced = useReducedMotion();
  const scene = useRef<HTMLDivElement>(null);
  const inView = useInView(scene,{margin:"80px"});
  const tiltX = useSpring(0,{stiffness:85,damping:24});
  const tiltY = useSpring(0,{stiffness:85,damping:24});
  const selected = items[index % Math.max(items.length,1)];
  const delayed = !!(news.data?.stale || news.data?.error || news.error);
  useEffect(()=>{if(!inView||hover||focused||manual||reduced||items.length<2)return;const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>i+1)},10000);return()=>clearInterval(timer)},[inView,hover,focused,manual,reduced,items.length]);
  return <MotionSurface className="reference-hero">
    <div className="ref-copy"><span className="ref-eyebrow">REAL IDEAS. REAL CONNECTIONS.<br/>A MORE OPEN FINANCIAL SYSTEM.</span><span className="ref-copy-rule"/><h1>Every market<br/>starts with<br/><em>a reason.</em></h1><p>Discover the thesis. Hold the coin.<br/>Earn the stocks.</p><div className="ref-actions"><Link href="/launch" className="lk-button primary">Launch your LINKR <ArrowRight size={18}/></Link><Link href="/vaults" className="lk-button quiet">Explore the thesis gallery <ArrowRight size={18}/></Link></div><div className="ref-facts"><div><b>One coin.</b><span>YOUR CONVICTION</span></div><div><b>Real stocks.</b><span>AS REWARDS</span></div><div><b>On Solana.</b><span>BUILT TO CONNECT</span></div></div><ContractAddress/></div>
    <div ref={scene} className="ref-scene" data-active={inView&&!reduced} onPointerMove={e=>{if(reduced||e.pointerType!=="mouse")return;const r=e.currentTarget.getBoundingClientRect();tiltX.set(-((e.clientY-r.top)/r.height-.5)*3);tiltY.set(((e.clientX-r.left)/r.width-.5)*4)}} onPointerLeave={()=>{setHover(false);tiltX.set(0);tiltY.set(0)}} onMouseEnter={()=>setHover(true)} onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false)}}>
      <Connections/><div className="ref-blue-caustic"/><div className="ref-pane ref-pane-one"/><div className="ref-pane ref-pane-two"/><div className="ref-pane ref-pane-three"/>
      <motion.div className="ref-main-plane" style={{rotateX:tiltX,rotateY:tiltY}}>
        <article className="ref-main-card"><div className="ref-card-rim"/><div className="ref-featured"><span>FEATURED THESIS</span><span className="ref-theme-badge">Theme inspiration</span></div>
          <div className="ref-ai-identity"><Image src={themes[0].image} width={100} height={118} alt="Cobalt glass compute stack" preload/><div><h2>THE AI STACK</h2><p>{themes[0].sub}</p><Chips tickers={themes[0].tickers}/></div></div>
          <HeroVolume/>
          <div className="ref-news" data-delayed={delayed}><div className="ref-news-top"><span><i/> {delayed ? "NEWSWIRE · DELAYED" : "FROM THE NEWSWIRE"}</span>{selected && <span>{selected.source.name} · {stamp(selected.publishedAt)}</span>}</div><AnimatePresence mode="wait"><motion.div key={selected?.id??"waiting"} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}} transition={{duration:reduced?0:.25}} className="ref-news-headline">{selected ? <a href={selected.url??undefined} target="_blank" rel="noreferrer">{selected.title}<ArrowUpRight size={13}/></a> : <span>{news.isLoading ? "Connecting to the newswire…" : "The newswire is unavailable."}{!news.isLoading && <button onClick={()=>void news.refetch()}>Retry</button>}</span>}</motion.div></AnimatePresence><div className="ref-news-controls">{items.map((item,i)=><button key={item.id} aria-label={`Read headline ${i+1}`} aria-pressed={index%items.length===i} onClick={()=>{setIndex(i);setManual(true)}}><span/></button>)}{manual&&<button aria-label="Resume headline rotation" onClick={()=>setManual(false)}><ArrowsClockwise size={12}/></button>}<Link href="/news">All news <ArrowRight size={12}/></Link></div></div>
        </article>
      </motion.div>
      <div className="ref-satellites">{themes.slice(1).map(theme=><article key={theme.className} className={`ref-theme ref-theme-${theme.className}`}><div className="ref-theme-back"/><div className="ref-theme-front"><Image src={theme.image} fill sizes="(max-width: 600px) 70vw, 25vw" alt={`${theme.name} concept illustration`}/><div className="ref-theme-content"><span className="ref-concept-label">THEME INSPIRATION</span><h3>{theme.name}</h3><p>{theme.sub}</p><div className="ref-theme-bottom"><Chips tickers={theme.tickers}/><Link href="/launch" aria-label={`Create your own ${theme.name} thesis`}><ArrowRight size={17}/></Link></div></div></div></article>)}</div>
      <span className="ref-scene-note">SAME MARKETS.<br/>A MORE CONNECTED<br/>TOMORROW.</span>
    </div>
    <div className="ref-theme-strip"><div className="ref-strip-heading"><h2>Markets with a reason.</h2><span>Explore a narrative. Make it yours.</span><Link href="/vaults">View live markets <ArrowRight size={17}/></Link></div><div className="ref-strip-cards">{themes.map(theme=><Link key={theme.name} href="/launch" className="ref-strip-card"><Image src={theme.image} alt="" width={75} height={75}/><div><h3>{theme.name}</h3><span>{theme.tickers.join(" · ")}</span><small>Explore this idea <ArrowUpRight size={12}/></small></div><ArrowRight size={18}/></Link>)}</div><p className="ref-strip-disclaimer">Editorial themes, not launched markets or investment recommendations. Artwork is illustrative; the chart shows actual NVDAx pool data.</p></div>
  </MotionSurface>;
}
