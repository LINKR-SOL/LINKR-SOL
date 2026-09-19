"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowSquareOut } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";
import { CATEGORY_LABEL, type NewsItem } from "@/lib/news/types";
import { NewsThumb, SampleBadge } from "./news-bits";
import { NewsThesis } from "./news-thesis";

function Row({
  item,
  active,
  onSelect,
}: {
  item: NewsItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={`news-row${active ? " active" : ""}`}>
      {/* The row selects; the ↗ links out. Siblings rather than nested anchors, so both
          stay keyboard-reachable and the markup stays valid. */}
      <button type="button" className="news-row-hit" onClick={onSelect} aria-pressed={active}>
        <NewsThumb item={item} />
        <span className="news-row-copy">
          <strong>{item.title}</strong>
          <small>
            <time dateTime={item.publishedAt}>{timeAgo(item.publishedAt)}</time>
            <i aria-hidden="true">·</i>
            {CATEGORY_LABEL[item.category]}
            {item.tickers.length > 0 && (
              <>
                <i aria-hidden="true">·</i>
                {item.tickers.slice(0, 3).join(" ")}
              </>
            )}
          </small>
        </span>
      </button>
      {item.url && (
        <a
          className="news-row-out"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Read "${item.title}" on ${item.source.name}`}
          title={`Read on ${item.source.name}`}
        >
          <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="news-row is-skeleton" aria-hidden="true">
      <span className="news-row-hit">
        <span className="news-thumb sm skeleton" />
        <span className="news-row-copy">
          <span className="skeleton skeleton-line" style={{ width: "82%" }} />
          <span className="skeleton skeleton-line" style={{ width: "40%" }} />
        </span>
      </span>
    </div>
  );
}

/**
 * The newswire board: what came in on the left, what it means for a pair asset on the right.
 *
 * Used at two scales — a five-row cut on the landing page and the full wire on /news —
 * so a story reads the same way wherever it is met.
 */
export function NewsBoard({
  items,
  isLoading,
  preview = false,
  compact = false,
  emptyLabel,
  total,
}: {
  items: NewsItem[];
  isLoading: boolean;
  preview?: boolean;
  compact?: boolean;
  emptyLabel?: string;
  /** How many stories matched, when more are held back behind "show more". */
  total?: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Following the wire means the freshest story leads until the reader picks another;
  // once they have, keep their pick even as new stories arrive above it. Deriving the
  // selection rather than storing it means a pick that scrolls off the wire falls back
  // to the lead on its own.
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  return (
    <div className={`news-board${compact ? " compact" : ""}`}>
      <div className="news-live">
        <div className="news-live-head">
          <span className="news-live-title">
            <i aria-hidden="true" />
            Live news
            {preview && <SampleBadge compact />}
          </span>
          {compact ? (
            <Link className="news-all" href={"/news" as Route}>
              All news
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          ) : (
            <small>
              {total !== undefined && total > items.length
                ? `${items.length} of ${total} stories`
                : `${items.length} ${items.length === 1 ? "story" : "stories"}`}
            </small>
          )}
        </div>

        <div className="news-rows">
          {isLoading && items.length === 0 ? (
            Array.from({ length: compact ? 4 : 8 }).map((_, i) => <SkeletonRow key={i} />)
          ) : items.length === 0 ? (
            <p className="news-empty">{emptyLabel ?? "Nothing on the wire right now."}</p>
          ) : (
            items.map((item) => (
              <Row key={item.id} item={item} active={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />
            ))
          )}
        </div>
      </div>

      <NewsThesis item={selected} items={items} onSelect={setSelectedId} />
    </div>
  );
}
