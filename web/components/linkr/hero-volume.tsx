"use client";
import { useId, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import type { HeroHistory } from "@/lib/xstocks/hero-history";
import { ArrowUpRight } from "@/components/ui/icons";

const date = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
export function HeroVolume() {
  const { data, isPending, isFetching, refetch } = useQuery<HeroHistory>({
    queryKey: ["hero", "nvdax-history"],
    queryFn: async () => { const r = await fetch("/api/hero-market"); if (!r.ok) throw new Error("History unavailable"); return r.json(); },
    staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1,
  });
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState<number | null>(null);
  const [metric, setMetric] = useState<"volume" | "close">("volume");
  const candles = data?.candles ?? [];
  const index = Math.min(selected ?? candles.length - 1, candles.length - 1);
  const current = candles[index];
  const values = candles.map(c => c[metric]);
  const max = Math.max(...values, 1);
  const min = metric === "volume" ? 0 : Math.min(...values) * .985;
  const range = max - min || 1;
  const x = (i: number) => 12 + (i + .5) * 376 / Math.max(candles.length, 1);
  const y = (v: number) => 118 - (v - min) / range * 87;
  const line = candles.map((c, i) => `${i ? "L" : "M"}${x(i)},${y(c.close)}`).join(" ");
  const selectObservation = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * 400;
    setSelected(Math.max(0, Math.min(candles.length - 1, Math.floor((px - 12) / 376 * candles.length))));
  };
  return <div className="ref-chart">
    <div className="ref-chart-heading"><span>NVDAx · MARKET ACTIVITY</span><div className="ref-chart-toggle" aria-label="Chart metric">{(["volume", "close"] as const).map(value => <button key={value} aria-pressed={metric === value} onClick={() => setMetric(value)}>{value === "volume" ? "Volume" : "Price"}</button>)}</div></div>
    {current ? <>
      <div className="ref-chart-number"><div><strong>{metric === "volume" ? money(current.volume) : `$${current.close.toFixed(2)}`}</strong><span>{metric === "volume" ? "Daily pool trading volume" : "Daily closing token price"} · USD</span></div><div className="ref-chart-date"><i />{date(current.t)}<small>Completed UTC day</small></div></div>
      <div className="ref-chart-plot" role="slider" tabIndex={0} aria-label="Explore NVDAx daily market history" aria-valuemin={0} aria-valuemax={candles.length - 1} aria-valuenow={index} aria-valuetext={`${date(current.t)}: ${metric === "volume" ? money(current.volume) : `$${current.close.toFixed(2)}`} ${metric === "volume" ? "trading volume" : "closing price"}`} onPointerDown={selectObservation} onKeyDown={e => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); setSelected(e.key === "Home" ? 0 : e.key === "End" ? candles.length - 1 : Math.max(0, Math.min(candles.length - 1, index + (e.key === "ArrowLeft" ? -1 : 1)))); }
      }} onPointerMove={selectObservation} onPointerLeave={e => { if(e.pointerType === "mouse") setSelected(null); }}>
        <svg viewBox="0 0 400 143" aria-hidden="true"><defs><linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#0064ff"/><stop offset="1" stopColor="#b9d8ff" stopOpacity=".6"/></linearGradient><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#0064ff" stopOpacity=".2"/><stop offset="1" stopColor="#0064ff" stopOpacity="0"/></linearGradient></defs>
          {[31,74,118].map((n,i) => <g key={n}><line x1="12" x2="388" y1={n} y2={n} stroke="#bcd3f0" strokeOpacity=".35"/><text x="12" y={n-5} fontSize="8" fill="#7792b2">{metric === "volume" ? `$${((max*(2-i)/2)/1e6).toFixed(1)}m` : `$${(max-range*i/2).toFixed(0)}`}</text></g>)}
          {metric === "volume" ? candles.map((c,i) => <motion.rect key={c.t} x={x(i)-8} width="16" rx="2" fill={`url(#${id}-bar)`} initial={reduced ? false : { y:118,height:0 }} animate={{ y:y(c.volume),height:118-y(c.volume),opacity:index===i?1:.67 }} transition={{ duration:reduced?0:.7,delay:reduced?0:i*.026,ease:[.22,.68,0,1] }}/>) : <><path d={`${line}L${x(candles.length-1)},118L${x(0)},118Z`} fill={`url(#${id}-area)`}/><motion.path d={line} fill="none" stroke="#0066ff" strokeWidth="2.4" initial={reduced?false:{pathLength:0}} animate={{pathLength:1}} transition={{duration:reduced?0:1}}/><circle cx={x(index)} cy={y(current.close)} r="4" fill="#0066ff" stroke="white" strokeWidth="2"/></>}
          <line x1={x(index)} x2={x(index)} y1="24" y2="118" stroke="#0066ff" strokeOpacity=".2" strokeDasharray="3 3"/>
          {[0, Math.floor(candles.length/2),candles.length-1].map((n,i)=><text key={`${n}-${i}`} x={i===0?12:i===2?388:200} y="139" textAnchor={i===0?"start":i===2?"end":"middle"} fontSize="9" fill="#6d87a9">{date(candles[n].t)}</text>)}
        </svg>
      </div>
      <div className="ref-chart-source"><span>{data?.stale ? "Cached · delayed" : "Verified pool history"} · not LINKR payouts</span><a href={data?.sourceUrl} target="_blank" rel="noreferrer">GeckoTerminal <ArrowUpRight size={11}/></a></div>
    </> : <div className="ref-chart-unavailable"><span>{isPending ? "Reading the market…" : "Market history is unavailable."}</span><p>{isPending ? "Connecting to verified NVDAx pool observations." : "No estimated or sample values are shown."}</p>{!isPending && <button disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "Checking…" : "Retry history"}</button>}</div>}
  </div>;
}
