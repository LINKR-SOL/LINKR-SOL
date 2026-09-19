"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import meta from "./mountain-meta.json";

/**
 * The hero's mountain range — four photographic depth planes on their own
 * scroll rates, with a layer of life moving between them and the wire's
 * catalysts pinned to the peaks.
 *
 * Planes (scripts/build-mountain-photos.py, public/mountains/ATTRIBUTION.md):
 *   sky · peak · mid · near — further planes LAG the scroll more, so the summit
 *   sinks behind the foreground on the way down. The cursor shifts the same
 *   planes by a few px each (03_FRONTEND_SPEC §5: "cursor proximity can shift
 *   background depth slightly").
 *
 * Cause Markers: the four highest points of the range (summit, second peak,
 * mid-range crest, foreground crest — exported by the build) each carry one
 * real story from the wire. Hover opens the headline; click opens the source.
 * A causal line runs from the summit marker to the Breaking card with a signal
 * travelling it — information moving from event to market, on the mountain.
 *
 * Life: cloud wisps at three depths, an aircraft with contrail, a flock between
 * the peak and middle range, an eagle soaring between the near planes,
 * occasional meteors, slow sun rays behind the summit, spindrift off the top.
 *
 * RESPECT_REDUCED_MOTION: the parallax and ambient motion are the hero's
 * content, so by default they run regardless of the OS preference. Flip this
 * to true to gate them on prefers-reduced-motion.
 */
const RESPECT_REDUCED_MOTION = false;

const TRAVEL = { sky: 420, peak: 330, mid: 150, near: 40, mist: 220 };
const DRIFT = { peak: -22, mid: 34, near: -12 };
/** Cursor parallax amplitude, px at the frame edge. Nearer planes move more. */
const MOUSE = { sky: 5, far: 7, peak: 10, life: 13, mid: 16, near: 24 };

export interface HeroMarker {
  id: string;
  label: string;
  title: string;
  source: string;
  when: string;
  url: string | null;
}

type Anchor = { x: number; y: number };
const ANCHORS = meta.anchors as Record<"apex" | "second" | "mid" | "near", Anchor>;

/* ------------------------------------------------------------------ helpers */

/** Where an `object-fit: cover; object-position: center bottom` image is drawn
 *  inside its box, so overlays can be pinned to image coordinates. */
function useCoverRect(boxRef: React.RefObject<HTMLElement | null>, imgW: number, imgH: number) {
  const [rect, setRect] = useState({ scale: 1, ox: 0, oy: 0, w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const scale = Math.max(w / imgW, h / imgH);
      setRect({ scale, ox: (w - imgW * scale) / 2, oy: h - imgH * scale, w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boxRef, imgW, imgH]);
  return rect;
}

/** Normalised cursor position over the hero, −1…1 on each axis, spring-smoothed. */
function useCursor(hostRef: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 55, damping: 18, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 55, damping: 18, mass: 0.6 });
  useEffect(() => {
    const host = hostRef.current?.parentElement;
    if (!host || !enabled) return;
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
      my.set(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const leave = () => {
      mx.set(0);
      my.set(0);
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [hostRef, enabled, mx, my]);
  return { sx, sy };
}

function Plane({
  name,
  z,
  y,
  x,
  scale,
  className = "",
  eager,
  children,
  boxRef,
}: {
  name: string;
  z: number;
  y: MotionValue<number> | number;
  x: MotionValue<number> | number;
  scale?: MotionValue<number> | number;
  className?: string;
  eager?: boolean;
  children?: React.ReactNode;
  boxRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <motion.div ref={boxRef} className={`mtn-layer ${className}`} style={{ y, x, scale, zIndex: z }}>
      <picture>
        <source srcSet={`/mountains/${name}.webp`} type="image/webp" />
        <img src={`/mountains/${name}.png`} alt="" decoding="async" loading={eager ? "eager" : "lazy"} />
      </picture>
      {children}
    </motion.div>
  );
}

function CauseMarker({
  m,
  left,
  top,
  flip,
  lead,
  delay,
}: {
  m: HeroMarker;
  left: number;
  top: number;
  flip: boolean;
  lead?: boolean;
  delay: number;
}) {
  return (
    <div
      className={`cause-marker ${flip ? "is-left" : ""} ${lead ? "is-lead" : ""}`}
      style={{ left, top, ["--cm-delay" as string]: `${delay}ms` }}
    >
      <i className="cm-dot" id={lead ? "cause-anchor" : undefined} />
      <i className="cm-rule" />
      <div className="cm-label">
        <b className="num">{m.id}</b>
        <span>{m.label}</span>
      </div>
      <a
        className="cm-card"
        href={m.url ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-label={`${m.id}: ${m.title}`}
      >
        <span className="cm-card-meta">
          {m.source} · {m.when}
        </span>
        <strong>{m.title}</strong>
        <span className="cm-card-cta">Open catalyst →</span>
      </a>
    </div>
  );
}

/** The causal line, summit marker → Breaking card, with a signal travelling it.
 *  Both ends move (the marker with the parallax, the card with the page), so the
 *  path is re-measured every frame while the hero is on screen. */
function CausalLink({ hostRef, active }: { hostRef: React.RefObject<HTMLDivElement | null>; active: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let visible = true;
    const host = hostRef.current;
    if (!host) return;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(host);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const a = document.getElementById("cause-anchor");
      const c = host.parentElement?.querySelector<HTMLElement>(".catalyst-flag");
      const p = pathRef.current;
      if (!a || !c || !p) return;
      const h = host.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const ax = ar.left + ar.width / 2 - h.left;
      const ay = ar.top + ar.height / 2 - h.top;
      const cx = cr.left + 26 - h.left;
      const cy = cr.top - h.top;
      const bend = Math.max(60, (cy - ay) * 0.55);
      p.setAttribute("d", `M${ax.toFixed(1)},${ay.toFixed(1)} C${ax.toFixed(1)},${(ay + bend).toFixed(1)} ${cx.toFixed(1)},${(cy - bend).toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`);
      if (!ready) setReady(true);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [hostRef, active, ready]);
  if (!active) return null;
  return (
    <svg className={`causal-link ${ready ? "is-ready" : ""}`} aria-hidden="true">
      <path ref={pathRef} id="causal-path" pathLength={1} />
      {ready && (
        <circle className="causal-signal" r="3.5">
          <animateMotion dur="3.4s" begin="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1">
            <mpath href="#causal-path" />
          </animateMotion>
        </circle>
      )}
    </svg>
  );
}

const BIRDS = [
  { x: 0, y: 0, d: 0 },
  { x: 34, y: -14, d: 0.12 },
  { x: 58, y: 6, d: 0.31 },
  { x: 86, y: -22, d: 0.05 },
  { x: 118, y: -4, d: 0.44 },
  { x: 142, y: 14, d: 0.2 },
  { x: 176, y: -10, d: 0.37 },
];

const SPINDRIFT = [0, 0.5, 0.9, 1.4, 1.9, 2.3, 2.8, 3.3];

/* ------------------------------------------------------------------ component */

export function MountainParallax({ markers = [] }: { markers?: HeroMarker[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const peakBox = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() && RESPECT_REDUCED_MOTION;

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const { sx, sy } = useCursor(ref, !reduce);

  // Scroll lag per plane…
  const skyS = useTransform(scrollYProgress, [0, 1], [0, TRAVEL.sky]);
  const peakS = useTransform(scrollYProgress, [0, 1], [0, TRAVEL.peak]);
  const midS = useTransform(scrollYProgress, [0, 1], [0, TRAVEL.mid]);
  const nearS = useTransform(scrollYProgress, [0, 1], [0, TRAVEL.near]);
  const mistS = useTransform(scrollYProgress, [0, 1], [0, TRAVEL.mist]);
  const lifeS = useTransform(scrollYProgress, [0, 1], [0, TRAVEL.peak * 0.85]);
  const peakDx = useTransform(scrollYProgress, [0, 1], [0, DRIFT.peak]);
  const midDx = useTransform(scrollYProgress, [0, 1], [0, DRIFT.mid]);
  const nearDx = useTransform(scrollYProgress, [0, 1], [0, DRIFT.near]);
  const nearScale = useTransform(scrollYProgress, [0, 1], [1, 1.07]);

  // …combined with the cursor offset. Vertical cursor travel is halved so the
  // range tilts rather than bobs.
  const skyY = useTransform([skyS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.sky * 0.5);
  const skyX = useTransform(sx, (m) => m * MOUSE.sky);
  const farY = useTransform([skyS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.far * 0.5);
  const farX = useTransform(sx, (m) => m * MOUSE.far);
  const peakY = useTransform([peakS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.peak * 0.5);
  const peakX = useTransform([peakDx, sx], ([s, m]) => (s as number) + (m as number) * MOUSE.peak);
  const lifeY = useTransform([lifeS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.life * 0.5);
  const lifeX = useTransform(sx, (m) => m * MOUSE.life);
  const midY = useTransform([midS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.mid * 0.5);
  const midX = useTransform([midDx, sx], ([s, m]) => (s as number) + (m as number) * MOUSE.mid);
  const nearY = useTransform([nearS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.near * 0.5);
  const nearX = useTransform([nearDx, sx], ([s, m]) => (s as number) + (m as number) * MOUSE.near);
  const mistY = useTransform([mistS, sy], ([s, m]) => (s as number) + (m as number) * MOUSE.mid * 0.5);

  const cover = useCoverRect(peakBox, meta.width, meta.height);
  const at = (a: Anchor) => ({
    left: cover.ox + a.x * meta.width * cover.scale,
    top: cover.oy + a.y * meta.height * cover.scale,
  });
  const apex = at(ANCHORS.apex);
  const second = at(ANCHORS.second);
  const midC = at(ANCHORS.mid);
  const nearC = at(ANCHORS.near);
  const placed = cover.w > 0;

  const off = (v: MotionValue<number>) => (reduce ? 0 : v);

  return (
    <div className={`mountains ${reduce ? "is-still" : ""}`} ref={ref} aria-hidden="true">
      <motion.picture className="mtn-sky" style={{ y: off(skyY), x: off(skyX) }}>
        <source srcSet="/mountains/photo-sky.webp" type="image/webp" />
        <img src="/mountains/photo-sky.png" alt="" decoding="async" />
      </motion.picture>
      <motion.div className="mtn-bloom" style={{ y: off(skyY), x: off(skyX) }} />

      {/* Far: rays, wisps, aircraft, meteors — behind the peak. */}
      <motion.div className="life life-far" style={{ y: off(farY), x: off(farX), zIndex: 1 }}>
        <div className="mtn-rays" />
        <span className="wisp wisp-a" />
        <span className="wisp wisp-b" />
        <i className="meteor meteor-a" />
        <i className="meteor meteor-b" />
        <div className="plane">
          <svg viewBox="0 0 40 12" width="34" height="10">
            <path d="M0 6.5 L26 5.2 L34 2 L36 2.4 L31 6 L38 6.4 L38 7.4 L31 7.6 L36 10.6 L34 11 L26 8.2 Z" />
          </svg>
          <i />
        </div>
      </motion.div>

      <Plane name="photo-peak" z={3} y={off(peakY)} x={off(peakX)} eager boxRef={peakBox}>
        {placed && (
          <>
            <div className="spindrift" style={apex}>
              {SPINDRIFT.map((d, i) => (
                <span key={i} style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
            {markers[0] && <CauseMarker m={markers[0]} {...apex} flip={ANCHORS.apex.x > 0.62} lead delay={900} />}
            {markers[1] && <CauseMarker m={markers[1]} {...second} flip={ANCHORS.second.x > 0.62} delay={1500} />}
          </>
        )}
      </Plane>

      {/* Between the peak and the middle range: a wisp and the flock. */}
      <motion.div className="life life-mid" style={{ y: off(lifeY), x: off(lifeX), zIndex: 4 }}>
        <span className="wisp wisp-c" />
        <div className="flock">
          <div className="flock-bob">
            {BIRDS.map((b, i) => (
              <span className="bird" key={i} style={{ left: b.x, top: b.y, animationDelay: `${b.d}s` }}>
                <svg viewBox="0 0 24 10">
                  <path className="wing" d="M12 6 C9.5 2.5, 5 1.5, 1 4.5" />
                  <path className="wing" d="M12 6 C14.5 2.5, 19 1.5, 23 4.5" />
                </svg>
              </span>
            ))}
          </div>
        </div>
      </motion.div>

      <Plane name="photo-mid" z={6} y={off(midY)} x={off(midX)} eager>
        {placed && markers[2] && <CauseMarker m={markers[2]} {...midC} flip={ANCHORS.mid.x > 0.62} delay={2000} />}
      </Plane>

      <motion.div className="mtn-mist" style={{ y: off(mistY), top: "62%", zIndex: 7 }} />

      {/* The eagle soars between the middle range and the foreground. */}
      <motion.div className="life life-near" style={{ y: off(midY), x: off(midX), zIndex: 7 }}>
        <div className="eagle">
          <svg viewBox="0 0 64 22">
            <path d="M32 13 C27 7, 18 3, 2 9 C13 9, 21 13, 29 17.5 C31 19, 33 19, 35 17.5 C43 13, 51 9, 62 9 C46 3, 37 7, 32 13 Z" />
          </svg>
        </div>
      </motion.div>

      <Plane
        name="photo-near"
        z={8}
        y={off(nearY)}
        x={off(nearX)}
        scale={reduce ? 1 : nearScale}
        className="is-near"
      >
        {placed && markers[3] && <CauseMarker m={markers[3]} {...nearC} flip={ANCHORS.near.x > 0.62} delay={2400} />}
      </Plane>

      <CausalLink hostRef={ref} active={placed && !!markers[0]} />

      <div className="mtn-grade" />
    </div>
  );
}
