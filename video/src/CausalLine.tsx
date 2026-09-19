import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, random } from "remotion";

/**
 * Linkr signature scene — 03_FRONTEND_SPEC §5 SECTION 03,
 * "Information moves before price does."
 *
 *     event ───────── Linkr ───────── market
 *
 * The order is the whole point (04_MOTION_SYSTEM §1: cause first, reaction
 * second). The chart is not allowed to exist until `market` has appeared, and
 * `market` is not allowed to appear until the causal line has reached it.
 *
 * The clip is a narrative, not an ambient loop, so it builds across ~85% of the
 * duration and dissolves back to an empty frame — meaning it still loops cleanly.
 */

const W = 1920;
const H = 1080;
const CY = H / 2;
const X_EVENT = 300;
const X_CAUSA = W / 2;
const X_MARKET = W - 300;
/** Clear space either side of the wordmark so the line never crosses it. */
const GAP = 205;

/** Eased 0→1 progress for a phase, clamped at both ends. */
const phase = (t: number, from: number, to: number) =>
  interpolate(t, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => 1 - Math.pow(1 - x, 3),
  });

/* The reaction the market has *after* the cause. Deterministic. */
const REACTION = Array.from({ length: 48 }, (_, i) => {
  const t = i / 47;
  return 92 - Math.pow(t, 0.7) * 74 - Math.sin(t * 7) * 7 - (random(`k${i}`) - 0.5) * 9;
});

export const CausalLine: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;

  const pEvent = phase(t, 0.04, 0.14);
  const pLineA = phase(t, 0.12, 0.36);   // event → Linkr
  const pCausa = phase(t, 0.34, 0.46);
  const pLineB = phase(t, 0.44, 0.64);   // Linkr → market
  const pMarket = phase(t, 0.62, 0.72);
  const pChart = phase(t, 0.70, 0.90);   // reaction, strictly last
  const out = phase(t, 0.93, 1.0);       // dissolve back to an empty frame

  const alpha = 1 - out;

  const lineAX = X_EVENT + (X_CAUSA - GAP - X_EVENT) * pLineA;
  const lineBX = X_CAUSA + GAP + (X_MARKET - (X_CAUSA + GAP)) * pLineB;

  const chartN = Math.max(2, Math.round(REACTION.length * pChart));
  const chartPath = REACTION.slice(0, chartN)
    .map((y, i) => {
      const x = X_MARKET - 150 + (i / (REACTION.length - 1)) * 300;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${(CY + 150 + y).toFixed(1)}`;
    })
    .join(" ");

  return (
    <AbsoluteFill style={{ backgroundColor: "#1e1a1f", opacity: alpha }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(900px 620px at 50% 46%, rgba(242,90,56,0.09), transparent 70%)",
        }}
      />

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
        <defs>
          <filter id="cglow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ---- EVENT ---------------------------------------------------- */}
        <g opacity={pEvent}>
          <circle cx={X_EVENT} cy={CY} r={7} fill="#f25a38" filter="url(#cglow)" />
          <circle cx={X_EVENT} cy={CY} r={2.4} fill="#ffe4d2" />
          <text
            x={X_EVENT}
            y={CY - 46}
            fill="#faf7f1"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize={40}
            textAnchor="middle"
          >
            event
          </text>
          <text
            x={X_EVENT}
            y={CY + 62}
            fill="#8f8990"
            fontFamily="monospace"
            fontSize={15}
            letterSpacing="2.6"
            textAnchor="middle"
          >
            18:42:08 UTC
          </text>
        </g>

        {/* ---- causal line, event → Linkr ------------------------------- */}
        <line
          x1={X_EVENT + 14}
          y1={CY}
          x2={lineAX}
          y2={CY}
          stroke="#f25a38"
          strokeWidth={1.5}
          opacity={pLineA > 0 ? 0.95 : 0}
        />

        {/* ---- Linkr locks centre --------------------------------------- */}
        <g opacity={pCausa}>
          <text
            x={X_CAUSA}
            y={CY + 15}
            fill="#faf7f1"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize={62}
            letterSpacing="4"
            textAnchor="middle"
          >
            Linkr
          </text>
          <text
            x={X_CAUSA + 104}
            y={CY + 15}
            fill="#f25a38"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize={62}
            textAnchor="middle"
          >
            .
          </text>
        </g>

        {/* ---- causal line, Linkr → market ------------------------------ */}
        <line
          x1={X_CAUSA + GAP}
          y1={CY}
          x2={lineBX}
          y2={CY}
          stroke="#f25a38"
          strokeWidth={1.5}
          opacity={pLineB > 0 ? 0.95 : 0}
        />

        {/* ---- MARKET ---------------------------------------------------- */}
        <g opacity={pMarket}>
          <circle cx={X_MARKET} cy={CY} r={7} fill="#f25a38" filter="url(#cglow)" />
          <circle cx={X_MARKET} cy={CY} r={2.4} fill="#ffe4d2" />
          <text
            x={X_MARKET}
            y={CY - 46}
            fill="#faf7f1"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize={40}
            textAnchor="middle"
          >
            market
          </text>
        </g>

        {/* ---- REACTION — only after market exists ---------------------- */}
        <g opacity={pChart}>
          <line
            x1={X_MARKET}
            y1={CY + 16}
            x2={X_MARKET}
            y2={CY + 128}
            stroke="#f25a38"
            strokeWidth={1}
            opacity={0.42}
          />
          <path d={chartPath} fill="none" stroke="#6dbf9c" strokeWidth={2} strokeLinejoin="round" />
          {chartN > 2 && (
            <circle
              cx={X_MARKET - 150 + ((chartN - 1) / (REACTION.length - 1)) * 300}
              cy={CY + 150 + REACTION[chartN - 1]}
              r={4}
              fill="#6dbf9c"
              filter="url(#cglow)"
            />
          )}
          <text
            x={X_MARKET + 158}
            y={CY + 156}
            fill="#6dbf9c"
            fontFamily="monospace"
            fontSize={17}
            textAnchor="end"
          >
            +18.4%
          </text>
        </g>

        {/* Sequence label — the product loop, spelled out once. */}
        <text
          x={W / 2}
          y={H - 92}
          fill="#6e696f"
          fontFamily="monospace"
          fontSize={14}
          letterSpacing="7"
          textAnchor="middle"
          opacity={pCausa * 0.9}
        >
          EVENT → CONTEXT → MARKET
        </text>
      </svg>

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 100% 76% at 50% 50%, transparent 46%, rgba(20,17,22,0.78) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.04,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </AbsoluteFill>
  );
};
