"use client";

import { useEffect, useRef } from "react";

/** Bump when the video files are re-rendered, to defeat browser caching. */
const V = "3";

/**
 * A looping video plate.
 *
 * The video always loads and always plays. An earlier version of this component
 * swapped in the poster image under `prefers-reduced-motion` and never attached
 * the <video> at all — which meant anyone with macOS "Reduce motion" enabled saw
 * a permanently static hero and no video anywhere on the site.
 *
 * These plates are the page's content, not decoration, so they are not gated on
 * that preference. What is still honoured: the video is silent, has no parallax
 * or scroll-coupled movement attached to it, and pauses whenever it scrolls out
 * of view so it costs nothing off-screen.
 */
export function CinematicPlate({
  name,
  className = "",
  fit = "cover",
  label,
}: {
  /** Basename in /public/video — e.g. "herolandscape". */
  name: string;
  className?: string;
  fit?: "cover" | "contain";
  /** Describes the plate for assistive tech; omit for purely decorative plates. */
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // Some browsers ignore the autoplay attribute until the element is in the
    // document and muted is applied; kick it explicitly as well.
    el.muted = true;
    const kick = () => void el.play().catch(() => {});
    kick();

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) kick();
        else el.pause();
      },
      { threshold: 0 },
    );
    io.observe(el);

    // If the tab was backgrounded on load, autoplay can be deferred.
    document.addEventListener("visibilitychange", kick);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);

  return (
    <div
      className={`plate ${className}`}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <video
        ref={videoRef}
        className="plate-media"
        style={{ objectFit: fit }}
        poster={`/video/${name}.jpg?v=${V}`}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      >
        <source src={`/video/${name}.webm?v=${V}`} type="video/webm" />
        <source src={`/video/${name}.mp4?v=${V}`} type="video/mp4" />
      </video>
    </div>
  );
}
