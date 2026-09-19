"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "@/components/ui/icons";
import { useNews } from "@/lib/hooks/useNews";
import { LiveStatus } from "@/components/terminal/live-status";
import { NewsBoard } from "./news-board";
import { SampleBadge } from "./news-bits";

/** Enough rows that the list stands as tall as the thesis panel beside it; at five the
 *  board had a hole in its bottom-left corner. */
const HOME_ROWS = 8;

/**
 * The newswire band on the landing page.
 *
 * It sits directly under the narrative desk on purpose: that section argues a basket
 * beats a ticker, and this one shows the headlines doing the pulling. With no provider
 * wired up the band renders nothing at all rather than an empty frame.
 */
export function NewsDesk() {
  const { data, isLoading } = useNews({ limit: 12 });
  const items = (data?.data?.items ?? []).slice(0, HOME_ROWS);

  if (!isLoading && items.length === 0) return null;

  return (
    <section className="news-section" id="news">
      <div className="news-header">
        <div>
          <span className="section-kicker">Newswire</span>
          <h2>
            The headline moves <em>more than one name.</em>
          </h2>
          <p>
            Stories on the tokenised stocks you can actually pair to, each one priced against today&apos;s real move.
            When a story runs through a whole basket, pairing to one ticker is a guess about which member reacts.
          </p>
        </div>
        <div className="news-header-status">
          {data?.preview && <SampleBadge />}
          <LiveStatus
            fetchedAt={data?.fetchedAt}
            stale={data?.stale}
            error={data?.error}
            empty={!isLoading && items.length === 0}
            label="Wire"
          />
        </div>
      </div>

      <NewsBoard items={items} isLoading={isLoading} preview={data?.preview} compact />

      <Link className="news-section-more" href={"/news" as Route}>
        Open the newswire
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}
