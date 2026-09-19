import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, random } from "remotion";

/**
 * Linkr closing cinematic — 03_FRONTEND_SPEC §5 SECTION 11,
 * "Consensus is expensive. Being early isn't."
 *
 * The headline is the animation. A field of market participants sits dark. One
 * node registers the catalyst first and lights Signal Orange. A slow wave of
 * recognition crosses the field; every node it reaches turns pale and inert —
 * that is consensus arriving, and arriving late. The early node stays orange the
 * whole way through.
 *
 * 04_MOTION_SYSTEM §21 asks this section to "slow the experience down", so the
 * wave crosses once per loop and nothing else competes with it.
 */

const W = 1920;
const H = 1080;
const COLS = 34;
const ROWS = 19;

const NODES = Array.from({ length: COLS * ROWS }, (_, i) => {
  const cx = i % COLS;
  const cy = Math.floor(i / COLS);
  // Jitter off the lattice so it reads as a market, not a grid.
  const jx = (random(`jx${i}`) - 0.5) * 26;
  const jy = (random(`jy${i}`) - 0.5) * 26;
  return {
    x: (cx + 0.5) * (W / COLS) + jx,
    y: (cy + 0.5) * (H / ROWS) + jy,
    r: 1.3 + random(`r${i}`) * 1.9,
    lag: random(`l${i}`) * 0.09, // not everyone notices at the same moment
  };
});

/** The node that was early. Left of centre, so the wave has room to travel. */
const ORIGIN = { x: W * 0.27, y: H * 0.44 };

const STAGES = ["SIGNAL", "CONTEXT", "CONVICTION", "MARKET"];
const MAX_D = Math.hypot(W, H);

export const ConsensusWave: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;

  // One slow crossing per loop, with quiet space either side of it.
  const wave = interpolate(t, [0.1, 0.86], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const waveR = wave * MAX_D * 1.06;

  const originOn = interpolate(t, [0.03, 0.1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fade = 1 - interpolate(t, [0.94, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const stageIdx = Math.min(STAGES.length - 1, Math.floor(wave * STAGES.length));

  return (
    <AbsoluteFill style={{ backgroundColor: "#171319", opacity: fade }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(760px 760px at ${(ORIGIN.x / W) * 100}% ${(ORIGIN.y / H) * 100}%, rgba(242,90,56,${0.13 * originOn}), transparent 68%)`,
        }}
      />

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
        <defs>
          <filter id="wglow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {NODES.map((n, i) => {
          const d = Math.hypot(n.x - ORIGIN.x, n.y - ORIGIN.y);
          const reach = waveR - d - n.lag * MAX_D;
          // 0 → untouched, 1 → fully arrived. The band is wide so the front is
          // a gradient of realisation rather than a hard edge.
          const lit = interpolate(reach, [-260, 90], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          // At the leading edge a node flashes warm, then settles to pale grey:
          // the moment of noticing, followed by it being priced in.
          const edge = Math.max(0, 1 - Math.abs(reach) / 150);
          const rr = n.r * (1 + edge * 0.75);
          const col = edge > 0.35 ? "#f7a288" : "#a8a2a9";
          return (
            <circle
              key={i}
              cx={n.x}
              cy={n.y}
              r={rr}
              fill={col}
              opacity={0.05 + lit * 0.5 + edge * 0.45}
            />
          );
        })}

        {/* The wave front itself — one thin ring, no pulse loop. */}
        {wave > 0 && wave < 1 && (
          <circle
            cx={ORIGIN.x}
            cy={ORIGIN.y}
            r={waveR}
            fill="none"
            stroke="#f25a38"
            strokeWidth={1}
            opacity={0.16 * (1 - wave)}
          />
        )}

        {/* The node that was early. It never dims. */}
        <g opacity={originOn}>
          <circle cx={ORIGIN.x} cy={ORIGIN.y} r={8} fill="#f25a38" filter="url(#wglow)" />
          <circle cx={ORIGIN.x} cy={ORIGIN.y} r={2.6} fill="#ffe4d2" />
          <text
            x={ORIGIN.x + 22}
            y={ORIGIN.y + 6}
            fill="#f7b7a4"
            fontFamily="monospace"
            fontSize={16}
            letterSpacing="2"
          >
            C/18472
          </text>
        </g>

        {/* SIGNAL → CONTEXT → CONVICTION → MARKET */}
        <g>
          {STAGES.map((s, i) => {
            const x = W * 0.5 + (i - (STAGES.length - 1) / 2) * 366;
            const on = i <= stageIdx ? 1 : 0.22;
            return (
              <g key={s}>
                <text
                  x={x}
                  y={H - 92}
                  fill={i === stageIdx ? "#f25a38" : "#8f8990"}
                  fontFamily="monospace"
                  fontSize={17}
                  letterSpacing="4.5"
                  textAnchor="middle"
                  opacity={on}
                >
                  {s}
                </text>
                {i < STAGES.length - 1 && (
                  <line
                    x1={x + 118}
                    y1={H - 97}
                    x2={x + 248}
                    y2={H - 97}
                    stroke={i < stageIdx ? "#f25a38" : "#4a444b"}
                    strokeWidth={1}
                    opacity={0.85}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 104% 80% at 50% 48%, transparent 40%, rgba(18,15,20,0.86) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.045,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </AbsoluteFill>
  );
};
