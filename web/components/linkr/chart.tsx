"use client";
import {useId,useState,useMemo} from "react";
import {motion} from "motion/react";
export function MarketChart({points,label,unit="$"}:{points:{t:number;priceUsd:number}[];label:string;unit?:string}){
 const id=useId().replace(/:/g,"");const[cursor,setCursor]=useState<number|null>(null);
 const data=useMemo(()=>points.filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.priceUsd)).sort((a,b)=>a.t-b.t),[points]);
 if(data.length<2)return <div className="chart-empty"><div className="chart-empty-grid"/><span>Waiting for market history</span><small>A chart appears when two verified data points are available.</small></div>;
 const min=Math.min(...data.map(p=>p.priceUsd)),max=Math.max(...data.map(p=>p.priceUsd)); const delta=max-min||Math.max(max*.01,1);
 const position=(p:typeof data[number])=>({x:12+(p.t-data[0].t)/(data[data.length-1].t-data[0].t||1)*416,y:115-(p.priceUsd-min)/delta*95});
 const d=data.map((p,i)=>{const c=position(p);return `${i?"L":"M"}${c.x},${c.y}`}).join(" ");
 const current=data[Math.min(cursor??data.length-1,data.length-1)];const pos=position(current);
 const time=(t:number)=>new Date(t>1e12?t:t*1000).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"});
 return <div className="market-chart" tabIndex={0} role="img" aria-label={`${label}. ${data.length} observations. Latest ${unit}${data.at(-1)!.priceUsd}. Arrow keys explore.`} onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();setCursor(i=>Math.max(0,Math.min(data.length-1,(i??data.length-1)+(e.key==="ArrowLeft"?-1:1))))}}} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();setCursor(Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*(data.length-1)))}} onPointerLeave={()=>setCursor(null)}>
 <div className="chart-caption"><span>{label}</span><strong>{unit}{current.priceUsd.toLocaleString("en-US",{maximumSignificantDigits:6})}</strong></div>
 <svg viewBox="0 0 440 138" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#086aff" stopOpacity=".18"/><stop offset="1" stopColor="#086aff" stopOpacity="0"/></linearGradient></defs>{[25,70,115].map(y=><line key={y} x1="12" x2="428" y1={y} y2={y} stroke="#9cb7d4" strokeOpacity=".2" strokeDasharray="3 5"/>)}<path d={`${d} L428 138 L12 138Z`} fill={`url(#${id})`}/><motion.path key={data.length} d={d} fill="none" stroke="#0968ff" strokeWidth="2.5" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.4,ease:"easeOut"}}/>{cursor!==null&&<line x1={pos.x} x2={pos.x} y1="0" y2="138" stroke="#496da1" strokeDasharray="3 4"/>}<circle cx={pos.x} cy={pos.y} r="4" fill="#0066ff" stroke="white" strokeWidth="2"/></svg>
 <div className="chart-axis"><span>{time(data[0].t)}</span><span>Observed price · UTC</span><span>{time(data.at(-1)!.t)}</span></div></div>
}
