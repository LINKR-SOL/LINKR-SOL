"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowSquareOut } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";
import { useNews } from "@/lib/hooks/useNews";
import { SampleBadge } from "./news-bits";

const ROTATE_MS = 6000;

/**
 * A single line of wire under the hero headline.
 *
 * The hero already asks for a lot of attention, so the newswire gets one line and no
 * more: the freshest headlines cycle through it, rotation pauses on hover and focus so
 * the link never moves out from under the pointer, and the whole rail disappears when
 * there is no wire to show rather than sitting there empty.
 */
export function NewswireRail() {
  const { data } = useNews({ limit: 6 });
  const items = (data?.data?.items ?? []).slice(0, 5);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const id = setInterval(() => setIndex((v) => (v + 1) % items.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, items.length]);

  // Modulo rather than a reset effect: the wire can shrink between renders and the rail
  // just lands on a story that still exists.
  const item = items.length > 0 ? items[index % items.length] : null;
  if (!item) return null;

  const headline = (
    <>
      <strong>{item.title}</strong>
      <small>
        {item.source.name}
        <i aria-hidden="true">·</i>
        {timeAgo(item.publishedAt)}
      </small>
    </>
  );

  return (
    <div
      className="newswire-rail"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <span className="newswire-tag">
        <i aria-hidden="true" />
        Newswire
        {data?.preview && <SampleBadge compact />}
      </span>

      {/* Keyed on the item so each rotation replays the entrance. */}
      {item.url ? (
        <a className="newswire-headline" key={item.id} href={item.url} target="_blank" rel="noreferrer">
          {headline}
          <ArrowSquareOut size={12} aria-hidden="true" />
        </a>
      ) : (
        <Link className="newswire-headline" key={item.id} href={"/news" as Route}>
          {headline}
        </Link>
      )}

      <Link className="newswire-all" href={"/news" as Route}>
        All news
        <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </div>
  );
}
