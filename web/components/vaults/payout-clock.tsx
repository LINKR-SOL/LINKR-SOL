"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { Info } from "@/components/ui/info";
import { useNow } from "@/lib/hooks/useNow";
import { formatClock, formatRelative } from "@/lib/format";
import { AIRDROP_LAG_S } from "@/lib/launch/options";

/**
 * A payout's road to holders' wallets, live: the period closes → the keeper publishes → the review window runs → the
 * stocks are airdropped. Every milestone carries its wall-clock time and how long its step takes, the header says
 * which step is happening now and when the stocks should land, and the rail between milestones fills as each step
 * progresses, so "any minute" never appears.
 *
 * `publishedAt`/`claimableAt`/`deliveredAt` come from the payout once they exist; before that the times are estimates.
 */
export function PayoutClock({
  periodEnd,
  periodStart = null,
  keeperLag,
  disputeWindow,
  airdropLag = AIRDROP_LAG_S,
  publishedAt = null,
  claimableAt = null,
  deliveredAt = null,
  potEmpty = false,
  compact = false,
}: {
  periodEnd: number;
  periodStart?: number | null;
  keeperLag: number;
  disputeWindow: number;
  airdropLag?: number;
  publishedAt?: number | null;
  claimableAt?: number | null;
  deliveredAt?: number | null;
  potEmpty?: boolean;
  compact?: boolean;
}) {
  const now = useNow(1_000);
  const reduce = useReducedMotion();

  const closed = now >= periodEnd;
  const published = publishedAt !== null || claimableAt !== null;
  const reviewed = claimableAt !== null && now >= claimableAt;
  const delivered = deliveredAt !== null;
  // estimates never sit in the past: a step running late pushes everything after it forward from now
  const publishAt = publishedAt ?? (claimableAt !== null ? claimableAt - disputeWindow : Math.max(periodEnd + keeperLag, closed ? now : 0));
  const reviewEndsAt = claimableAt ?? publishAt + disputeWindow;
  const landsAt = deliveredAt ?? Math.max(reviewEndsAt + airdropLag, reviewed ? now : 0);
  // 0 period running · 1 publishing · 2 in review · 3 airdropping · 4 in wallets
  const step = delivered ? 4 : reviewed ? 3 : published ? 2 : closed ? 1 : 0;
  // the keeper retries every run; past a few of those, say so instead of a countdown that keeps slipping
  const overdue = step === 1 && now > periodEnd + keeperLag * 4;

  const frac = (from: number, to: number, cap = 1) => Math.min(cap, Math.max(0, to > from ? (now - from) / (to - from) : 1));
  // how far along each step between two milestones is; an estimated step never shows as finished before it is
  const segments = [
    step > 1 ? 1 : step === 1 ? frac(periodEnd, publishAt, 0.92) : 0,
    step > 2 ? 1 : step === 2 ? frac(publishAt, reviewEndsAt) : 0,
    step > 3 ? 1 : step === 3 ? frac(reviewEndsAt, reviewEndsAt + airdropLag, 0.92) : 0,
  ];
  const periodProgress = periodStart !== null && step === 0 ? frac(periodStart, periodEnd) : null;

  const milestones = [
    {
      key: "close",
      label: "Period closes",
      time: periodEnd,
      estimate: false,
      takes: "the snapshot",
      info: "The end of the payout period. Holdings are measured up to this second; anything bought after it counts toward the next payout.",
    },
    {
      key: "publish",
      label: "Published",
      time: publishAt,
      estimate: !published,
      takes: about(keeperLag),
      info: `LINKR's keeper replays every transfer of the coin, weighs each holder by amount × time held, and publishes the result on-chain. Usually within ${Math.round(keeperLag / 60) || 1}–2 minutes of the close.`,
    },
    {
      key: "review",
      label: "Review ends",
      time: reviewEndsAt,
      estimate: claimableAt === null,
      takes: `${fmtShort(disputeWindow)} review`,
      info: `A ${fmtShort(disputeWindow)} pause after publishing, during which the creator or LINKR can cancel a payout that looks wrong (the stocks then roll into the next one). It protects holders from a bad snapshot; it can't take anything from a correct one.`,
    },
    {
      key: "wallet",
      label: "In your wallet",
      time: landsAt,
      estimate: !delivered,
      takes: about(airdropLag),
      info: "The keeper's next run airdrops every holder's stocks straight to their wallet. Nothing to click. Very small shares wait until they add up to something worth sending.",
    },
  ];

  const status = [
    { label: "Period running", tone: "text-text" },
    { label: overdue ? "Keeper retrying" : "Keeper publishing", tone: overdue ? "text-warn" : "text-accent" },
    { label: "In review", tone: "text-accent" },
    { label: "Airdropping", tone: "text-accent" },
    { label: "In your wallet", tone: "text-success" },
  ][step];

  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className={cx("min-w-0", compact ? "text-[11px]" : "text-xs")}>
      {/* where it is now, and when it lands */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/60 px-2 py-0.5">
          <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", step === 4 ? "bg-success" : overdue ? "bg-warn" : "bg-accent clock-dot--active")} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={status.label}
              className={cx("font-medium", status.tone)}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: reduce ? 0.1 : 0.2, ease }}
            >
              {status.label}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="text-muted" aria-live="polite">
          {delivered ? (
            <>
              Delivered <span className="num text-text">{formatClock(landsAt)}</span>
            </>
          ) : (
            <>
              In your wallet ≈ <span className="num font-medium text-text">{formatClock(landsAt)}</span>
              <span className="num"> · {formatRelative(landsAt, now)}</span>
            </>
          )}
        </span>
      </div>

      {periodProgress !== null && (
        <div className="mb-3" aria-hidden>
          <div className="h-1 overflow-hidden rounded-full bg-border/70">
            <motion.div
              className="h-full origin-left rounded-full bg-accent/70"
              initial={false}
              animate={{ scaleX: periodProgress }}
              transition={{ duration: reduce ? 0 : 1, ease: "linear" }}
            />
          </div>
        </div>
      )}

      <ol className="relative grid grid-cols-4 gap-1">
        {/* the rail: three steps between four milestones, each filling as it progresses */}
        {segments.map((f, i) => (
          <span key={i} aria-hidden className="absolute top-[7px] h-[2px] overflow-hidden rounded-full bg-border" style={{ left: `${12.5 + i * 25}%`, width: "25%" }}>
            <motion.span
              className={cx("block h-full origin-left", f >= 1 ? "bg-success" : "bg-accent")}
              initial={false}
              animate={{ scaleX: f }}
              transition={{ duration: reduce ? 0 : 1, ease: "linear" }}
            />
          </span>
        ))}
        {milestones.map((m, i) => {
          const done = step > i;
          const active = step === i;
          return (
            <li key={m.key} className="relative min-w-0 text-center">
              <span
                aria-hidden
                className={cx(
                  "relative z-[1] mx-auto flex h-4 w-4 items-center justify-center rounded-full border-2 transition-colors duration-200",
                  done && "border-success bg-success",
                  active && (overdue ? "border-warn bg-surface" : "border-accent bg-surface clock-dot--active"),
                  !done && !active && "border-border-strong bg-surface",
                )}
              >
                <AnimatePresence initial={false}>
                  {done && (
                    <motion.span
                      key="check"
                      className="flex text-bg"
                      initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={reduce ? { duration: 0.1 } : { type: "spring", stiffness: 520, damping: 22 }}
                    >
                      <Check size={9} weight="bold" />
                    </motion.span>
                  )}
                  {active && !overdue && <span key="core" className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </AnimatePresence>
              </span>
              <div className={cx("mt-1.5 flex items-center justify-center gap-0.5 font-medium leading-tight", !done && !active ? "text-faint" : "text-text")}>
                <span className="truncate">{m.label}</span>
                <Info label={`About "${m.label}"`} align={i === 0 ? "start" : i === 3 ? "end" : "center"} side="bottom">
                  {m.info}
                </Info>
              </div>
              <div className={cx("num mt-0.5 leading-tight", !done && !active ? "text-faint" : "text-muted")}>
                {m.estimate ? "≈ " : ""}
                {formatClock(m.time)}
              </div>
              <div className={cx("mt-0.5 leading-tight", active ? "text-accent" : "text-faint")}>{m.takes}</div>
            </li>
          );
        })}
      </ol>

      <p className={cx("mt-3 leading-relaxed", overdue ? "text-warn" : "text-muted")}>
        {step === 4 ? (
          <>Airdropped. The stocks are in holders&apos; wallets.</>
        ) : step === 3 ? (
          <>
            Review is over. The keeper is sending the stocks now; they land <span className="num text-text">{formatRelative(landsAt, now)}</span>.
          </>
        ) : step === 2 ? (
          <>
            Published and in review. The review ends <span className="num text-text">{formatRelative(reviewEndsAt, now)}</span>, then the stocks are airdropped.
          </>
        ) : step === 1 ? (
          overdue ? (
            <>The keeper hasn&apos;t published this payout yet. It retries every run and nothing is lost: balances are measured on-chain, so the payout is the same whenever it lands.</>
          ) : (
            <>Period closed. The keeper is weighing every holder and publishing the payout.</>
          )
        ) : potEmpty ? (
          <>
            Closes <span className="num text-text">{formatRelative(periodEnd, now)}</span>. No fees have come in yet this period; if none arrive before the close, it rolls into the next one.
          </>
        ) : (
          <>
            Closes <span className="num text-text">{formatRelative(periodEnd, now)}</span>. Total from close to wallet: about{" "}
            <span className="num text-text">{fmtShort(keeperLag + disputeWindow + airdropLag)}</span>.
          </>
        )}
      </p>
    </div>
  );
}

/** A step that usually takes `seconds`, as a range a person reads at a glance: 90 s → "~1–2 min". */
function about(seconds: number): string {
  if (seconds <= 120) return "~1–2 min";
  return `~${Math.round(seconds / 60)} min`;
}

function fmtShort(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}
