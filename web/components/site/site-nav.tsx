"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useState} from "react";
import {BrandLockup} from "./brand";
import {WalletButton} from "./wallet-button";
import {LinkrTicker,SocialLinks,TelegramLaunch} from "./linkr-links";
import {ThemeToggle} from "./theme-toggle";
import {List,X,ArrowUpRight} from "@/components/ui/icons";
const links=[{href:"/",label:"Discover"},{href:"/vaults",label:"Markets"},{href:"/news",label:"Newswire"},{href:"/claims",label:"Portfolio"}];
export function SiteNav(){const path=usePathname();const[open,setOpen]=useState(false);return <header className="lk-nav"><svg className="filter-defs" aria-hidden="true"><defs><filter id="glass-refract" x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.08" numOctaves="1" seed="8" result="noise"/><feGaussianBlur in="noise" stdDeviation="2" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="15" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg><div className="nav-glass"/><div className="nav-edge"/><div className="lk-nav-inner"><Link href="/" className="lk-logo" aria-label="LINKR home" onClick={()=>setOpen(false)}><BrandLockup/></Link><nav className={`lk-links ${open?"is-open":""}`} aria-label="Main navigation">{links.map(l=><Link key={l.href} href={l.href} aria-current={path===l.href?"page":undefined} onClick={()=>setOpen(false)}>{l.label}</Link>)}<Link href="/launch" className="mobile-create" onClick={()=>setOpen(false)}>Create a market</Link><TelegramLaunch className="mobile-telegram" onClick={()=>setOpen(false)}/><div className="mobile-extras"><LinkrTicker/><SocialLinks/></div></nav><div className="lk-nav-actions"><LinkrTicker className="nav-extra"/><SocialLinks className="nav-extra"/><ThemeToggle/><Link className="nav-create" href="/launch">Create <ArrowUpRight size={15}/></Link><TelegramLaunch className="nav-extra"/><WalletButton/><button className="menu-toggle" aria-label={open?"Close menu":"Open menu"} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X/>:<List/>}</button></div></div></header>}
