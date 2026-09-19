"use client";

import { useMemo } from "react";
import { usePulse } from "@/lib/hooks/useTerminal";
import { formatUsd, formatNumber } from "@/lib/format";
import { useCountUp } from "@/components/site/count-up";
import { LiveStatus } from "./live-status";

/** Area sparkline over an hourly series. Returns null when there is nothing real to draw. */
function Spark({ values, accent }: { values: number[]; accent: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const w = 100;
    const h = 30;
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`);
    return { line: `M${pts.join("L")}`, area: `M0,${h}L${pts.join("L")}L${w},${h}Z` };
  }, [values]);
  if (!path) return null;
  return (
    <svg className="pulse-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={path.area} fill={accent} opacity="0.12" />
      <path d={path.line} fill="none" stroke={accent} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ label, value, display, note, series, accent }: { label: string; value: number; display: (n: number) => string; note: string; series?: number[]; accent: string }) {
  const shown = useCountUp(value);
  return (
    <div className="pulse-metric">
      <span>{label}</span>
      <strong>{display(shown)}</strong>
      <small>{note}</small>
      {series && series.length > 1 && <Spark values={series} accent={accent} />}
    </div>
  );
}

/**
 * StonkFun network state over the last day, as StonkFun's API reports it. These are the volumes LINKR's vaults sit on
 * top of, so they are the network's real figures — not ours — and are labelled that way.
 */
export function PulseBand() {
  const { data, isLoading } = usePulse();
  const pulse = data?.pulse;
  const totals = pulse?.data?.totals;
  const series = pulse?.data?.series ?? [];
  const launchSeries = series.map((p) => p.launches);
  const volumeSeries = series.every((p) => p.volumeSol !== null) ? series.map((p) => p.volumeSol as number) : null;

  if (!totals) {
    return (
      <section className="pulse-section" id="pulse">
        <div className="pulse-header">
          <span className="section-kicker">StonkFun network</span>
          <LiveStatus empty={!isLoading} error={pulse?.error} label="Live" />
        </div>
        <p className="pulse-empty">{isLoading ? "Reading the StonkFun network…" : "StonkFun's API is not answering. Nothing is shown rather than a placeholder."}</p>
      </section>
    );
  }

  return (
    <section className="pulse-section" id="pulse">
      <div className="pulse-header">
        <div>
          <span className="section-kicker">StonkFun network</span>
          <h2>
            The launchpad underneath. <em>Every number here is theirs.</em>
          </h2>
          <p>
            LINKR does not run its own curve. Coins launch on StonkFun and trade on Raydium — we change <strong>who the fees pay</strong>.
          </p>
        </div>
        <LiveStatus fetchedAt={pulse?.fetchedAt} stale={pulse?.stale} error={pulse?.error} source={pulse?.data?.source} />
      </div>
      <div className="pulse-grid">
        <Metric label="Coins launched" value={totals.launches24h} display={(n) => formatNumber(Math.round(n), { compact: true })} note={`in the last 24h · ${formatNumber(totals.launchesSeen, { compact: true })} seen so far`} series={launchSeries} accent="#ff6b3d" />
        <Metric
          label="Volume traded"
          value={totals.volumeUsd24h ?? totals.volumeSol24h ?? 0}
          display={(n) => (totals.volumeUsd24h !== null ? formatUsd(n, { compact: true }) : `${formatNumber(n, { compact: true })} SOL`)}
          note={totals.trades24h !== null ? `${formatNumber(totals.trades24h, { compact: true })} trades in the last 24h` : "across every StonkFun coin, last 24h"}
          series={volumeSeries ?? undefined}
          accent="#7b93ff"
        />
        <Metric label="LINKR vaults" value={totals.causaVaults} display={(n) => formatNumber(Math.round(n), { compact: true })} note="Coins whose holders are paid in stocks" accent="#3dd68c" />
        <Metric label="Live with a coin" value={totals.causaLaunches} display={(n) => formatNumber(Math.round(n), { compact: true })} note="Vaults bound to a StonkFun coin" accent="#e8b54d" />
      </div>
    </section>
  );
}
