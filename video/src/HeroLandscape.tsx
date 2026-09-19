import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, random } from "remotion";

/**
 * Linkr hero plate — 02_ASSET_GUIDE §5-B, "Market landscape".
 *
 * The market IS the terrain: the skyline is a price series and the cause markers
 * standing on it are the events that shaped it.
 *
 * The camera travels continuously right across the series, so there is always
 * obvious motion even at small size — the previous cut of this plate only had
 * ambient parallax and read as a still image. As each catalyst reaches centre
 * frame it fires: a ring pulses, the marker snaps in, and the stretch of ridge
 * after it lights up as the market reaction.
 *
 * Loop discipline: the terrain is a sum of sines whose frequencies are whole
 * numbers over the tile width, so it repeats exactly. The camera advances by
 * precisely one tile across the clip, which makes frame 0 and frame N identical.
 */

const W = 1920;
const H = 1080;
const TAU = Math.PI * 2;
const TILE = W; // terrain repeats every TILE px

/* --- terrain -------------------------------------------------------------- */
/** Sum of integer-frequency sines → tiles exactly over TILE. */
function seriesAt(x: number) {
  const u = (x / TILE) * TAU;
  return (
    620 +
    Math.sin(u) * 96 +
    Math.sin(u * 2 + 1.1) * 46 +
    Math.sin(u * 3 + 2.4) * 26 +
    Math.sin(u * 5 + 0.6) * 13 +
    Math.sin(u * 8 + 1.9) * 7
  );
}

/** A background ridge — same tiling trick, different phase and amplitude. */
function ridgeAt(x: number, seed: number, base: number, amp: number) {
  const u = (x / TILE) * TAU;
  return (
    base +
    Math.sin(u + seed) * amp +
    Math.sin(u * 2 + seed * 1.7) * amp * 0.42 +
    Math.sin(u * 4 + seed * 0.6) * amp * 0.2
  );
}

const RIDGES = [
  { seed: 0.4, base: 560, amp: 70, fill: "#3a2c3e", drift: 0.28 },
  { seed: 2.1, base: 640, amp: 92, fill: "#2e2333", drift: 0.5 },
  { seed: 4.3, base: 730, amp: 110, fill: "#241b28", drift: 0.74 },
];

/* Catalysts live in terrain space and scroll with it. */
const CATALYSTS = [
  { at: 0.12, id: "C/18472", label: "POLICY", attn: "+284%" },
  { at: 0.45, id: "C/18509", label: "CHIPS", attn: "+416%" },
  { at: 0.78, id: "C/18563", label: "ENERGY", attn: "+192%" },
];

const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: random(`sx${i}`) * W,
  y: random(`sy${i}`) * 400,
  r: 0.5 + random(`sr${i}`) * 1.4,
  cyc: 1 + Math.floor(random(`sc${i}`) * 3),
  ph: random(`sp${i}`) * TAU,
}));

/* Cloud bands drift at their own rate, which sells depth. */
const CLOUDS = Array.from({ length: 5 }, (_, i) => ({
  y: 190 + random(`cy${i}`) * 250,
  w: 620 + random(`cw${i}`) * 760,
  h: 26 + random(`ch${i}`) * 46,
  x0: random(`cx${i}`) * W,
  speed: 0.35 + random(`cs${i}`) * 0.5,
  op: 0.05 + random(`co${i}`) * 0.07,
}));

const path = (fn: (x: number) => number, offset: number, step = 8) => {
  let d = "";
  for (let x = -step; x <= W + step; x += step) {
    const y = fn(x + offset);
    d += `${d === "" ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
};

export const HeroLandscape: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;

  // The camera advances exactly one tile over the clip.
  const cam = t * TILE;

  // Slow vertical bob — small, but it stops the frame feeling locked off.
  const bob = Math.sin(TAU * t) * 12;

  // Sun tracks the same cycle, so light visibly changes as the camera travels.
  const sunPhase = (Math.sin(TAU * t - Math.PI / 2) + 1) / 2; // 0 → 1 → 0
  const sunY = 700 - sunPhase * 150;
  const daylight = sunPhase;

  const seriesPath = path((x) => seriesAt(x) + bob, cam, 6);

  return (
    <AbsoluteFill style={{ backgroundColor: "#1e1a1f" }}>
      {/* Sky. Warms up as the sun climbs. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg,
            #16121a 0%,
            #201826 ${26 + daylight * 4}%,
            #3a2533 ${48 + daylight * 5}%,
            #74392c ${62 + daylight * 5}%,
            #b8552c ${71 + daylight * 4}%,
            #1e1a1f ${78 + daylight * 3}%)`,
        }}
      />

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
        <defs>
          <radialGradient id="sun">
            <stop offset="0%" stopColor="#ffe9d6" stopOpacity="1" />
            <stop offset="38%" stopColor="#f25a38" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#f25a38" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f25a38" stopOpacity="0" />
            <stop offset="48%" stopColor="#f25a38" stopOpacity={0.1 + daylight * 0.12} />
            <stop offset="100%" stopColor="#f25a38" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="terrainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#241c26" />
            <stop offset="100%" stopColor="#151119" />
          </linearGradient>
          <filter id="soft" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <filter id="glow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Stars fade out as the sun rises. */}
        {STARS.map((s, i) => {
          const tw = (Math.sin(TAU * s.cyc * t + s.ph) + 1) / 2;
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y + bob * 0.3}
              r={s.r}
              fill="#faf7f1"
              opacity={(0.08 + tw * 0.26) * (1 - daylight * 0.75)}
            />
          );
        })}

        {/* Sun */}
        <circle cx={W * 0.63} cy={sunY + bob * 0.4} r={230} fill="url(#sun)" opacity={0.42 + daylight * 0.3} />
        <circle
          cx={W * 0.63}
          cy={sunY + bob * 0.4}
          r={46 + daylight * 16}
          fill="#ffeadb"
          opacity={0.7 + daylight * 0.3}
          filter="url(#soft)"
        />

        <rect x="0" y="300" width={W} height="420" fill="url(#haze)" />

        {/* Cloud bands, each on its own drift. */}
        {CLOUDS.map((c, i) => {
          const x = ((c.x0 - cam * c.speed) % (W + c.w)) - c.w;
          return (
            <ellipse
              key={i}
              cx={x + c.w / 2}
              cy={c.y + bob * 0.5}
              rx={c.w / 2}
              ry={c.h}
              fill="#f0b49a"
              opacity={c.op * (0.4 + daylight)}
              filter="url(#soft)"
            />
          );
        })}

        {/* Parallax ridges — each at its own speed. */}
        {RIDGES.map((r, i) => (
          <path
            key={i}
            d={`${path((x) => ridgeAt(x, r.seed, r.base, r.amp) + bob * (0.4 + i * 0.2), cam * r.drift, 14)} L${W},${H} L0,${H} Z`}
            fill={r.fill}
          />
        ))}

        {/* The price series — the skyline. */}
        <path d={`${seriesPath} L${W},${H} L0,${H} Z`} fill="url(#terrainFill)" />
        <path
          d={seriesPath}
          fill="none"
          stroke="#faf7f1"
          strokeWidth={2.2}
          strokeLinejoin="round"
          opacity={0.95}
          filter="url(#glow)"
        />

        {/* Catalysts. Each scrolls with the terrain and fires at centre frame. */}
        {CATALYSTS.map((c) => {
          // Position in screen space, wrapped into the visible tile.
          const raw = c.at * TILE - cam;
          const x = ((raw % TILE) + TILE) % TILE;
          const y = seriesAt(x + cam) + bob;

          // "Fires" as it crosses the middle third of frame.
          // interpolate() needs an ascending inputRange, so the ramp is expressed
          // left-to-right and the output inverted: the catalyst is fully fired at
          // centre frame and unlit by the time it is two-thirds across.
          const fire = interpolate(x, [W * 0.5, W * 0.62], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          // Fades out as it leaves frame left, and in as it enters right.
          const edge =
            interpolate(x, [0, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
            interpolate(x, [W - 260, W - 60], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          if (edge <= 0.001) return null;

          const ring = interpolate(fire, [0, 1], [6, 46]);
          const ringOp = (1 - fire) * fire * 4;

          // The market reaction: the ridge after the catalyst lights up.
          const reactW = fire * 330;
          let reactPath = "";
          if (reactW > 4) {
            for (let dx = 0; dx <= reactW; dx += 6) {
              const px = x + dx;
              reactPath += `${dx === 0 ? "M" : "L"}${px.toFixed(1)},${(seriesAt(px + cam) + bob).toFixed(1)}`;
            }
          }

          return (
            <g key={c.id} opacity={edge}>
              {reactPath && (
                <path
                  d={reactPath}
                  fill="none"
                  stroke="#f25a38"
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={0.9}
                  filter="url(#glow)"
                />
              )}
              <line x1={x} y1={y} x2={x} y2={y - 118 * fire} stroke="#f25a38" strokeWidth={1.2} opacity={0.62 * fire} />
              {ringOp > 0.01 && (
                <circle cx={x} cy={y} r={ring} fill="none" stroke="#f25a38" strokeWidth={1.4} opacity={ringOp * 0.55} />
              )}
              <circle cx={x} cy={y} r={4 + fire * 3} fill="#f25a38" filter="url(#glow)" />
              <circle cx={x} cy={y} r={1.6} fill="#ffeadb" />
              <g opacity={fire}>
                <text x={x + 12} y={y - 124} fill="#f7b7a4" fontFamily="monospace" fontSize={19} letterSpacing="1.6">
                  {c.id}
                </text>
                <text x={x + 12} y={y - 101} fill="#8f8990" fontFamily="monospace" fontSize={14} letterSpacing="2.6">
                  {c.label}
                </text>
                <text x={x + 12} y={y - 78} fill="#6dbf9c" fontFamily="monospace" fontSize={14} letterSpacing="1.2">
                  ATTN {c.attn}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* Vignette + grain. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 108% 80% at 50% 46%, transparent 40%, rgba(20,17,22,0.84) 100%)",
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
