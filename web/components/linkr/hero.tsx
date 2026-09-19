"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {AnimatePresence,motion,useReducedMotion} from "motion/react";
import {useNews} from "@/lib/hooks/useNews";
import {useFeed,useMarket} from "@/lib/hooks/useTerminal";
import type {NewsItem} from "@/lib/news/types";
import {ArrowRight,ArrowUpRight,ArrowsClockwise} from "@/components/ui/icons";
import {MotionSurface,SignalLines} from "./motion";
import {MarketChart} from "./chart";
import {BrandMark} from "@/components/site/brand";
const stamp=(value:string)=>new Date(value).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});
export function StoryArt({item}:{item?:NewsItem}){
 return <div className={`story-art art-${(item?.tickers[0]?.charCodeAt(0)??0)%3||0}`} aria-hidden="true"><div className="art-grid"/><div className="art-pane pane-a"/><div className="art-pane pane-b"/><div className="art-pane pane-c"/><span>{item?.tickers[0]||"LINKR"}</span><i/></div>
}
export function Hero(){
 const news=useNews({limit:8});const feed=useFeed("marketCap",12);const launch=feed.data?.data?.launches[0];const market=useMarket(launch?.mint??null);
 const items=news.data?.preview?[]:news.data?.data?.items??[];const[index,setIndex]=useState(0);const[hover,setHover]=useState(false);const[focused,setFocused]=useState(false);const[manual,setManual]=useState(false);const reduced=useReducedMotion();
 const selected=items[index%Math.max(items.length,1)]; const next=items.length>1?items[(index+1)%items.length]:undefined;const third=items.length>2?items[(index+2)%items.length]:undefined;
 useEffect(()=>{if(hover||focused||manual||reduced||items.length<2)return;const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>i+1)},10000);return()=>clearInterval(timer)},[hover,focused,manual,reduced,items.length]);
 return <MotionSurface className="lk-hero"><div className="hero-copy"><span className="eyebrow"><i className="blue-dot"/> CONNECT THE IDEA. OWN THE POSSIBILITY.</span><h1>Every market<br/>starts with<br/><em>a reason.</em></h1><p>Discover the thesis.<br/>Hold the coin. <span>Earn the stocks.</span></p><div className="hero-actions"><Link href="/vaults" className="lk-button primary">Explore markets <ArrowRight size={18}/></Link><Link href="/launch" className="lk-button quiet">Create your thesis <ArrowUpRight size={17}/></Link></div><div className="hero-footnote"><span className="tiny-links"><i/><i/></span><span>Trading fees become tokenised stocks.<br/>Distributed to the people who hold.</span></div></div>
 <div className="hero-scene" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false)}}><SignalLines/><div className="scene-halo"/><div className="glass-layer layer-one"/><div className="glass-layer layer-two"/><div className="glass-layer layer-three"/>
 <article className="feature-glass glass"><div className="feature-top"><span>THE SIGNAL</span><span className={`wire-status ${news.data?.stale?"stale":""}`}><i/>{news.isLoading?"Connecting":news.data?.stale?"Delayed":selected?"Newswire":"Offline"}</span></div>
 <AnimatePresence mode="wait"><motion.div key={selected?.id??"waiting"} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:.4}} className="feature-story">{selected?<><div className="feature-identity"><StoryArt item={selected}/><span>{selected.category}<small>{selected.source.name}</small></span></div><h2><a href={selected.url??undefined} target="_blank" rel="noreferrer">{selected.title}</a></h2><div className="stock-tags">{selected.tickers.slice(0,3).map(t=><span key={t}>{t}</span>)}<time dateTime={selected.publishedAt}>{stamp(selected.publishedAt)}</time></div></>:<><div className="feature-identity"><BrandMark size={54}/><span>Ideas in motion<small>LINKR Newswire</small></span></div><h2>{news.isLoading?"Connecting to the newswire.":"The next signal is on its way."}</h2><p className="feature-empty">{news.isLoading?"Reading the latest reports from public sources.":"News sources are unavailable. Try connecting again."}</p>{!news.isLoading&&<button className="text-action" onClick={()=>news.refetch()}>Retry news <ArrowsClockwise size={14}/></button>}</>}</motion.div></AnimatePresence>
 <div className="feature-chart"><div className="feature-chart-top"><span>MARKET WINDOW</span><small>{launch?launch.symbol:"StonkFun"}{market.data?.stale?" · delayed":""}</small></div><MarketChart points={market.data?.data?.points??[]} label={launch?launch.name:"Market price"}/></div>
 <div className="feature-bottom"><span>Independent market data · StonkFun</span><div className="story-controls">{items.slice(0,5).map((item,i)=><button key={item.id} aria-label={`Read headline ${i+1}`} aria-pressed={index%items.length===i} onClick={()=>{setIndex(i);setManual(true)}}/>)}{manual&&<button className="resume-stories" aria-label="Resume headline rotation" onClick={()=>setManual(false)}><ArrowsClockwise size={12}/></button>}</div></div></article>
 <div className="satellite-stories">{[next,third].map((item,i)=><article key={item?.id??i} className={`satellite glass satellite-${i}`}><StoryArt item={item}/><div><span className="eyebrow">{item?.source.name??(i?"THE CONNECTION":"THE CONTEXT")}</span><h3>{item?<a href={item.url??undefined} target="_blank" rel="noreferrer">{item.title}</a>:i?"One coin. Connected to more.":"Where ideas meet the market."}</h3>{item?<time dateTime={item.publishedAt}>{stamp(item.publishedAt)} <ArrowUpRight size={13}/></time>:<span className="satellite-note">Discover the LINKR approach</span>}</div></article>)}</div>
 <span className="scene-caption"><i/> MANY PERSPECTIVES. ONE CONNECTION.</span></div>
 <div className="hero-baseline"><span>ON SOLANA</span><i/><span>STOCKS AS REWARDS</span><i/><span>BUILT AROUND YOUR THESIS</span><a href="#how-it-works">Follow the connection <span>↓</span></a></div></MotionSurface>
}
