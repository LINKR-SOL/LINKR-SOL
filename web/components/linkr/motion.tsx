"use client";
import {useEffect,useRef,type ReactNode} from "react";
import {usePathname} from "next/navigation";
export function MotionSurface({children,className="",id}:{children:ReactNode;className?:string;id?:string}){
 const ref=useRef<HTMLElement>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const observer=new IntersectionObserver(([entry])=>{el.dataset.visible=String(entry.isIntersecting)},{rootMargin:"80px"});observer.observe(el);return()=>observer.disconnect()},[]);
 return <section ref={ref} id={id} className={`motion-surface ${className}`} data-visible="true">{children}</section>
}
export function PageMotion({children}:{children:ReactNode}){
 const path=usePathname();const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const elements=ref.current?.querySelectorAll("section,.lk-footer");if(!elements)return;const observer=new IntersectionObserver(entries=>entries.forEach(e=>(e.target as HTMLElement).dataset.visible=String(e.isIntersecting)),{rootMargin:"80px"});elements.forEach(el=>observer.observe(el));return()=>observer.disconnect()},[path]);
 return <div ref={ref} className="page-motion">{children}</div>
}
export function SignalLines(){return <svg className="signal-lines" viewBox="0 0 900 600" fill="none" preserveAspectRatio="none" aria-hidden="true"><path d="M0 470H140Q185 470 185 425V350Q185 315 235 315H570Q625 315 625 250V120Q625 80 680 80H900"/><path d="M0 520H210Q260 520 260 470V410Q260 370 310 370H740Q790 370 790 330V240Q790 205 850 205H900"/><path className="signal-travel" d="M0 470H140Q185 470 185 425V350Q185 315 235 315H570Q625 315 625 250V120Q625 80 680 80H900"/><circle cx="185" cy="390" r="5"/><circle cx="790" cy="300" r="5" className="orange"/><circle cx="625" cy="180" r="5"/></svg>}
