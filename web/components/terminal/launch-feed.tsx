"use client";

import { useState } from "react";
import { ArrowUpRight } from "@/components/ui/icons";
import { useFeed, type FeedSort } from "@/lib/hooks/useTerminal";
import type { FeedLaunch } from "@/lib/stonkfun/types";
import { formatUsd, formatNumber } from "@/lib/format";
import { PairMark } from "@/components/site/pair-mark";
import { coinUrl } from "@/lib/token";
import { LiveStatus } from "./live-status";

const TABS: [FeedSort, string][] = [
  ["recentBuys", "Trading now"],
  ["graduating", "Close to graduating"],
  ["graduated", "Graduated"],
  ["newest", "Just launched"],
];

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Coin logos come from IPFS gateways and frequently 404; fall back to a letter tile. */
function CoinMark({ launch }: { launch: FeedLaunch }) {
  const [failed, setFailed] = useState(false);
  if (!launch.logo || failed) {
    return (
      <i className="coin-mark letter" aria-hidden="true">
        {launch.symbol.replace(/^\$/, "").slice(0, 2).toUpperCase()}
      </i>
    );
  }
  return (
    <i className="coin-mark" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" src={launch.logo} loading="lazy" onError={() => setFailed(true)} />
    </i>
  );
}

function Row({ launch, index }: { launch: FeedLaunch; index: number }) {
  const pct = launch.graduated ? 100 : launch.graduationProgressPct;
  return (
    <a className="feed-row" href={launch.causaVaulted && launch.vault ? `/vaults/${launch.vault}` : coinUrl(launch.mint)} target={launch.causaVaulted ? undefined : "_blank"} rel="noreferrer">
      <span className="feed-rank">{String(index + 1).padStart(2, "0")}</span>
      <span className="feed-coin">
        <CoinMark launch={launch} />
        <span>
          <strong>{launch.symbol}</strong>
          <small>{launch.name}</small>
        </span>
      </span>
      <span className="feed-pair">
        {launch.causaVaulted ? (
          <em className="stock">
            <PairMark symbol="LINKR" small />
            stocks
          </em>
        ) : (
          <em className={launch.quote.kind}>
            <PairMark symbol={launch.quote.symbol} small logoUrl={launch.quote.logoUrl} />
            {launch.quote.symbol}
          </em>
        )}
        <small>{launch.causaVaulted ? "holders paid in xStocks" : launch.mode === "reward" ? "holders taxed, no creator fee" : `creator paid in ${launch.quote.symbol}`}</small>
      </span>
      <span className="feed-mcap">{launch.marketCapUsd ? formatUsd(launch.marketCapUsd, { compact: true }) : "—"}</span>
      <span className="feed-progress">
        <span className="feed-bar" role="presentation">
          <i className={launch.graduated ? "done" : undefined} style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <small>{launch.graduated ? "graduated" : `${formatNumber(pct, { maxFrac: 1 })}%`}</small>
      </span>
      <span className="feed-age">
        {age(launch.launchedAt)}
        <ArrowUpRight size={13} aria-hidden="true" />
      </span>
    </a>
  );
}

/**
 * The live StonkFun launch feed.
 *
 * The "Fees go to" column is the point of the whole table: on StonkFun every coin's creator fee is paid to one
 * wallet in SOL. The coins launched through LINKR pay it to their holders in stocks instead.
 */
const PAGE = 15;

export function LaunchFeed() {
  const [sort, setSort] = useState<FeedSort>("recentBuys");
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isFetching } = useFeed(sort, 40);
  const all = data?.data?.launches ?? [];
  const launches = expanded ? all : all.slice(0, PAGE);
  const vaulted = data?.causaVaulted ?? 0;
  const sampled = data?.sampled ?? 0;

  return (
    <section className="feed-section" id="feed">
      <div className="feed-header">
        <div>
          <span className="section-kicker">Live on StonkFun</span>
          <h2>
            Every one of these pays <em>one</em> wallet.
          </h2>
          {sampled > 0 && (
            <p>
              <strong>
                {vaulted} of the {sampled} coins in view
              </strong>{" "}
              pay their holders in tokenised stocks. The rest send every creator fee to a single wallet — which is what StonkFun does by default.
            </p>
          )}
        </div>
        <LiveStatus fetchedAt={data?.fetchedAt} stale={data?.stale} error={data?.error} empty={!isLoading && launches.length === 0} label={isFetching ? "Refreshing" : "Live"} />
      </div>

      {data?.data && (
        <div className="feed-totals">
          <div>
            <dt>Trading now</dt>
            <dd>{formatNumber(data.data.activeTotal, { compact: true })}</dd>
          </div>
          <div>
            <dt>Graduated</dt>
            <dd>{formatNumber(data.data.graduatedTotal, { compact: true })}</dd>
          </div>
          <div>
            <dt>Launches seen</dt>
            <dd>{formatNumber(data.data.launchTotal, { compact: true })}</dd>
          </div>
        </div>
      )}

      <div className="feed-tabs" role="tablist">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={sort === value}
            className={sort === value ? "active" : ""}
            onClick={() => {
              setSort(value);
              setExpanded(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="feed-table">
        <div className="feed-head">
          <span>#</span>
          <span>Coin</span>
          <span>Fees go to</span>
          <span>Market cap</span>
          <span>To graduation</span>
          <span>Age</span>
        </div>
        {isLoading && launches.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div className="feed-row is-skeleton" key={i} aria-hidden="true">
              <span className="skeleton skeleton-line" style={{ width: 18 }} />
              <span className="feed-coin">
                <span className="skeleton skeleton-mark" />
                <span className="skeleton skeleton-line" style={{ width: "55%" }} />
              </span>
              <span className="skeleton skeleton-line" style={{ width: "60%" }} />
              <span className="skeleton skeleton-line" style={{ width: "50%" }} />
              <span className="skeleton skeleton-line" style={{ width: "80%" }} />
              <span className="skeleton skeleton-line" style={{ width: "40%" }} />
            </div>
          ))
        ) : launches.length === 0 ? (
          <div className="feed-empty">
            <p>The StonkFun feed is not responding right now.</p>
            <small>Nothing is shown in its place — this table only ever renders real launches.</small>
          </div>
        ) : (
          launches.map((l, i) => <Row key={`${l.mint}-${i}`} launch={l} index={i} />)
        )}
      </div>

      {all.length > PAGE && (
        <button type="button" className="feed-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all ${all.length}`}
        </button>
      )}
    </section>
  );
}
