"use client";

import { useEffect, useRef, useState } from "react";
import createGlobe, { type Globe } from "cobe";

/**
 * The relation graph for SECTION 10, "Nothing moves alone".
 *
 * Nodes are listing venues; arcs run from the US venues every reference asset is
 * listed on out to where the reaction is actually traded. Node count is held to
 * 14 — the pack caps the graph at "8-14 visible meaningful nodes" so it reads as
 * structured intelligence rather than a screensaver.
 *
 * cobe v2 has no onRender callback — the render loop is ours to drive, by calling
 * update() with a new phi each frame.
 */
const VENUES: { name: string; location: [number, number]; size: number }[] = [
  // Size encodes listing weight — NYSE/Nasdaq are where these stocks actually
  // live, so New York reads largest and the rest fall off from there.
  { name: "New York", location: [40.7128, -74.006], size: 0.055 },
  { name: "Chicago", location: [41.8781, -87.6298], size: 0.032 },
  { name: "London", location: [51.5074, -0.1278], size: 0.04 },
  { name: "Frankfurt", location: [50.1109, 8.6821], size: 0.026 },
  { name: "Dubai", location: [25.2048, 55.2708], size: 0.026 },
  { name: "Mumbai", location: [19.076, 72.8777], size: 0.026 },
  { name: "Singapore", location: [1.3521, 103.8198], size: 0.036 },
  { name: "Hong Kong", location: [22.3193, 114.1694], size: 0.032 },
  { name: "Tokyo", location: [35.6762, 139.6503], size: 0.04 },
  { name: "Seoul", location: [37.5665, 126.978], size: 0.026 },
  { name: "Sydney", location: [-33.8688, 151.2093], size: 0.026 },
  { name: "São Paulo", location: [-23.5505, -46.6333], size: 0.026 },
  { name: "Lagos", location: [6.5244, 3.3792], size: 0.022 },
  { name: "Berlin", location: [52.52, 13.405], size: 0.022 },
];

const NY: [number, number] = [40.7128, -74.006];
const ARCS = VENUES.filter((v) => v.name !== "New York" && v.name !== "Chicago").map((v) => ({
  from: NY,
  to: v.location,
}));

export function GlobeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Drag-to-spin state, kept in refs so the render loop never re-subscribes.
  const phiRef = useRef(0);
  const thetaRef = useRef(0.22);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const spinRef = useRef(0.0022);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) spinRef.current = 0;

    let globe: Globe | null = null;
    let raf = 0;
    let width = 0;
    let visible = true;

    const onResize = () => {
      width = wrap.offsetWidth;
      globe?.update({ width: width * 2, height: width * 2 });
    };

    width = wrap.offsetWidth;
    if (width === 0) return;

    globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio ?? 1, 2),
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: thetaRef.current,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 17000,
      mapBrightness: 6.4,
      mapBaseBrightness: 0.04,
      baseColor: [0.115, 0.098, 0.12],
      markerColor: [0.949, 0.353, 0.22],
      glowColor: [0.3, 0.15, 0.12],
      arcColor: [0.949, 0.353, 0.22],
      arcWidth: 0.28,
      arcHeight: 0.35,
      markers: VENUES.map((v) => ({ location: v.location, size: v.size })),
      arcs: ARCS,
      opacity: 0.95,
    });

    // Fade in only once the first frame has actually been painted, so the globe
    // never pops in as a black square.
    const reveal = window.setTimeout(() => setReady(true), 120);

    const tick = () => {
      if (visible && globe) {
        if (!dragRef.current) phiRef.current += spinRef.current;
        globe.update({ phi: phiRef.current, theta: thetaRef.current });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Stop doing GPU work while the globe is scrolled out of frame.
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
    io.observe(wrap);

    const onDown = (e: PointerEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      phiRef.current += (e.clientX - d.x) * 0.005;
      thetaRef.current = Math.max(-0.8, Math.min(0.8, thetaRef.current + (e.clientY - d.y) * 0.005));
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      dragRef.current = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(reveal);
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
      globe?.destroy();
    };
  }, []);

  return (
    <div className="globe-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        style={{ opacity: ready ? 1 : 0 }}
        aria-label="Relation graph of listing venues and the routes between them. Drag to rotate."
        role="img"
      />
      <div className="globe-halo" aria-hidden="true" />
    </div>
  );
}
