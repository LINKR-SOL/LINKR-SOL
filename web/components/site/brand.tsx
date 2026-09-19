"use client";

import { useId } from "react";

/** Native vector artwork. Two open, interlocking links, with no raster or background. */
export function BrandMark({ size = 42, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const upper = "M34 24V21Q34 11 44 11H64Q74 11 74 21V44Q74 54 64 54H47Q37 54 37 44V36";
  const lower = "M52 65V68Q52 78 42 78H22Q12 78 12 68V45Q12 35 22 35H39Q49 35 49 45V53";
  return (
    <span className={`linkr-mark linkr-vector ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 88 90" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-body`} x1="8" y1="73" x2="75" y2="15" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0062F4"/><stop offset=".13" stopColor="#07172F"/>
            <stop offset=".43" stopColor="#081222"/><stop offset=".64" stopColor="#0A3260"/>
            <stop offset=".82" stopColor="#101726"/><stop offset="1" stopColor="#FF922F"/>
          </linearGradient>
          <linearGradient id={`${id}-rim`} x1="22" y1="12" x2="60" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="#AADFFF"/><stop offset=".16" stopColor="#1284FF"/>
            <stop offset=".35" stopColor="#042653"/><stop offset=".65" stopColor="#529EFF"/>
            <stop offset="1" stopColor="#0047B7"/>
          </linearGradient>
          <linearGradient id={`${id}-warm`} x1="69" y1="12" x2="73" y2="34" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFCC83"/><stop offset=".5" stopColor="#F88A23"/>
            <stop offset="1" stopColor="#F88A23" stopOpacity="0"/>
          </linearGradient>
          <mask id={`${id}-fade`} maskUnits="userSpaceOnUse" x="0" y="0" width="88" height="90">
            <linearGradient id={`${id}-mask`} x2="0" y2="1">
              <stop stopColor="black"/><stop offset=".035" stopColor="white"/>
              <stop offset=".965" stopColor="white"/><stop offset="1" stopColor="black"/>
            </linearGradient>
            <path fill={`url(#${id}-mask)`} d="M0 0h88v90H0z"/>
          </mask>
          <g id={`${id}-links`} strokeLinecap="butt" strokeLinejoin="round">
            <path d={upper} stroke="#06172C" strokeWidth="13"/>
            <path d={upper} stroke={`url(#${id}-rim)`} strokeWidth="11.5"/>
            <path d={upper} stroke={`url(#${id}-body)`} strokeWidth="8.5"/>
            <path d="M37 22V21Q37 14 44 14H62" stroke="#A4DAFF" strokeWidth="1.2" strokeLinecap="round" opacity=".85"/>
            <path d="M65 6Q79 7 79 21V34" stroke={`url(#${id}-warm)`} strokeWidth="1.8" strokeLinecap="round"/>
            <path d={lower} stroke="#06172C" strokeWidth="13"/>
            <path d={lower} stroke={`url(#${id}-rim)`} strokeWidth="11.5"/>
            <path d={lower} stroke={`url(#${id}-body)`} strokeWidth="8.5"/>
            <path d="M15 47V45Q15 38 22 38H37Q46 38 46 46" stroke="#9AD9FF" strokeWidth="1.2" strokeLinecap="round" opacity=".85"/>
            <path d="M8 59V68Q8 82 22 82H35" stroke="#197DF8" strokeWidth="1.3" strokeLinecap="round"/>
          </g>
        </defs>
        <g mask={`url(#${id}-fade)`}>
          <g className="linkr-chain-belt">
            <use href={`#${id}-links`}/>
            <use href={`#${id}-links`} transform="translate(0 90)"/>
          </g>
        </g>
      </svg>
    </span>
  );
}

export function BrandWordmark() {
  return <span className="brand-word">LINKR</span>;
}

export function BrandLockup({ markSize = 46 }: { markSize?: number }) {
  return <><BrandMark size={markSize}/><BrandWordmark/></>;
}
