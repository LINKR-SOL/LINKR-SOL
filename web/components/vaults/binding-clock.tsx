"use client";

import Link from "next/link";
import type { Route } from "next";
import { Spinner, cx } from "@/components/ui/primitives";
import { Info } from "@/components/ui/info";
import { useNow } from "@/lib/hooks/useNow";
import { formatClock, formatRelative } from "@/lib/format";
import { fmtDuration } from "@/lib/launch/options";

/** How long the keeper usually needs to notice a fresh launch: one cron tick plus a curve read. */
const BIND_LAG_S = 120;

/**
 * The wait between "I launched" and "fees are flowing", made legible: launch → keeper binds the coin to this
 * vault → first period runs → first payout closes. Same visual grammar as the payout clock, so a creator
 * who has seen one knows how to read the other.
 */
export function BindingClock({
  launchedAt,
  epochLength,
  launchHref,
  symbol,
}: {
  /** ISO time of the StonkFun launch, or null while the coin has not launched yet */
  launchedAt: string | null;
  epochLength: number;
  launchHref?: Route;
  symbol?: string | null;
}) {
  const now = useNow(1_000);
  const launched = launchedAt ? Math.floor(new Date(launchedAt).getTime() / 1000) : null;
  const bindEta = launched !== null ? launched + BIND_LAG_S : null;
  const overdue = bindEta !== null && now > bindEta + BIND_LAG_S * 2;
  const firstClose = bindEta !== null ? bindEta + epochLength : null;

  const stages: { key: string; label: string; time: number | null; estimate: boolean; state: "done" | "active" | "pending"; info: string }[] = [
    {
      key: "launch",
      label: "Coin launched",
      time: launched,
      estimate: false,
      state: launched !== null ? "done" : "active",
      info: "The coin exists on StonkFun with this vault named as its creator. From this moment every trade pays 0.5% of its volume to the vault.",
    },
    {
      key: "bind",
      label: "Keeper binds",
      time: bindEta,
      estimate: true,
      state: launched === null ? "pending" : "active",
      info: `LINKR's keeper checks StonkFun every minute; when it sees the coin's pool name this vault as creator it starts the first payout period. Usually about ${Math.round(BIND_LAG_S / 60)} minutes after the launch.`,
    },
    {
      key: "period",
      label: "Fees flow",
      time: bindEta,
      estimate: true,
      state: "pending",
      info: "Creator fees are collected, converted into the basket and counted toward the running payout period. Holders see their projected share on the Watchlist.",
    },
    {
      key: "close",
      label: "First payout",
      time: firstClose,
      estimate: true,
      state: "pending",
      info: `The first period closes ${fmtDuration(epochLength)} after the bind; the payout is published right after and becomes claimable once the review window ends.`,
    },
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-surface-2/40 px-3 py-3 text-xs">
      <ol className="relative grid grid-cols-4 gap-1">
        <span aria-hidden className="absolute left-[12.5%] right-[12.5%] top-[5px] h-px bg-border" />
        {stages.map((s) => (
          <li key={s.key} className="relative min-w-0 text-center">
            <span
              aria-hidden
              className={cx(
                "relative z-[1] mx-auto block h-[11px] w-[11px] rounded-full border-2 transition-colors duration-200",
                s.state === "done" && "border-success bg-success",
                s.state === "active" && "border-accent bg-accent clock-dot--active",
                s.state === "pending" && "border-border-strong bg-surface",
              )}
            />
            <div className={cx("mt-1.5 flex items-center justify-center gap-0.5 font-medium leading-tight", s.state === "pending" ? "text-faint" : "text-text")}>
              <span className="truncate">{s.label}</span>
              <Info label={`About "${s.label}"`} align={s.key === "launch" ? "start" : s.key === "close" ? "end" : "center"} side="bottom">
                {s.info}
              </Info>
            </div>
            <div className={cx("num mt-0.5 leading-tight", s.state === "pending" ? "text-faint" : "text-muted")}>
              {s.time === null ? "—" : `${s.estimate ? "≈ " : ""}${formatClock(s.time)}`}
            </div>
            {s.state === "active" && s.key === "bind" && (
              <div className="mt-1 flex items-center justify-center gap-1 text-accent">
                <Spinner className="h-3 w-3" />
                <span className="sr-only">in progress</span>
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className={cx("mt-3 leading-relaxed", overdue ? "text-warn" : "text-muted")} aria-live="polite">
        {launched === null ? (
          <>
            Nothing is running until the coin launches.{" "}
            {launchHref && (
              <Link href={launchHref} className="underline text-accent">
                Launch it now
              </Link>
            )}
            {" "}Once it does, the keeper binds it within about {Math.round(BIND_LAG_S / 60)} minutes and the first payout closes {fmtDuration(epochLength)} later.
          </>
        ) : overdue ? (
          <>
            {symbol ? `${symbol} launched` : "Launched"} {formatRelative(launched, now)} and the keeper has not bound it yet. It retries every minute; the
            fees are already accruing on StonkFun and nothing is lost — binding only starts the clock.
          </>
        ) : (
          <>
            {symbol ? `${symbol} launched` : "Launched"} {formatRelative(launched, now)}. Binding expected{" "}
            <span className="num text-text">{formatRelative(bindEta!, now)}</span> (≈ {formatClock(bindEta!)}); first payout ≈ {formatClock(firstClose!)}. This page
            updates on its own.
          </>
        )}
      </p>
    </div>
  );
}
