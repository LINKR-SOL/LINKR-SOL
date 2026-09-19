"use client";

import { useState } from "react";

import Link from "next/link";
import { ArrowUpRight, ArrowsClockwise, Coins, Gift } from "@/components/ui/icons";
import type { Route } from "next";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { explorerTxUrl } from "@/lib/solana/cluster";
import { useClaims, useVaults } from "@/lib/hooks/useApi";
import { useNow } from "@/lib/hooks/useNow";
import { useSolanaTx } from "@/lib/hooks/useSolanaTx";
import { useSignedAction } from "@/lib/hooks/useSignedAction";
import { useToast } from "@/components/ui/toast";
import { isCustodial } from "@/lib/solana/cluster";
import { useProgram } from "@/lib/hooks/useProgram";
import { claimIxs } from "@/lib/solana/ix";
import { unhex } from "@/lib/dividends/merkle";
import { formatUsd, shortAddress, timeAgo, usdOf } from "@/lib/format";
import type { ClaimableVaultJson, ClaimsJson, TokenJson } from "@/lib/api-types";
import { Badge, Button, Card, Skeleton, cx } from "@/components/ui/primitives";
import { Info } from "@/components/ui/info";
import { PayoutClock } from "./payout-clock";
import { PUBLISH_LAG_S } from "@/lib/launch/options";
import { Relative } from "@/components/ui/live-time";
import { formatClock } from "@/lib/format";
import { fmtToken } from "./vault-panel";
import { CoinTile } from "./vaults-list";
import { ProjectionCard } from "./projection-card";

/** Claims per transaction: each carries its own token transfers, and four keeps the size comfortably under the limit. */
const CLAIMS_PER_TX = 4;

/** Total USD of a list of (amount, token) pairs; null when nothing in it could be priced. */
function totalUsd(rows: { amount: string; token: TokenJson }[]): number | null {
  let total = 0;
  let priced = false;
  for (const r of rows) {
    const u = usdOf(r.amount, r.token.decimals, r.token.priceUsd);
    if (u !== null) {
      total += u;
      priced = true;
    }
  }
  return priced ? total : null;
}

/**
 * Token amounts summed per mint and written out ("0.14 NVDAx + 0.02 TSLAx"), for when nothing can be priced
 * (devnet mocks, a stock without a Jupiter quote). Two mints are spelled out; more are counted.
 */
function amountsText(rows: { amount: string; token: TokenJson }[]): string | null {
  const byMint = new Map<string, { token: TokenJson; total: bigint }>();
  for (const r of rows) {
    const amt = BigInt(r.amount);
    if (amt === 0n) continue;
    const cur = byMint.get(r.token.mint);
    if (cur) cur.total += amt;
    else byMint.set(r.token.mint, { token: r.token, total: amt });
  }
  const parts = [...byMint.values()].map((x) => fmtToken(x.total, x.token));
  if (parts.length === 0) return null;
  return parts.length <= 2 ? parts.join(" + ") : `${parts[0]} + ${parts.length - 1} more`;
}

/** The three numbers a holder actually opens this page for. */
function Summary({ data, now }: { data: ClaimsJson; now: number }) {
  const ready = data.vaults.flatMap((v) =>
    v.epochs.filter((e) => e.status === "published" && e.claimableAt !== null && e.claimableAt <= now).flatMap((e) => e.tokens.map((token, i) => ({ token, amount: e.amounts[i] }))),
  );
  const projected = data.projections.flatMap((p) => p.vault.basket.map((token, i) => ({ token, amount: p.amounts[i] ?? "0" })));
  const history = data.history.flatMap((h) => h.tokens.map((token, i) => ({ token, amount: h.amounts[i] })));
  const building = data.projections.reduce<number | null>((sum, p) => (p.usd === null ? sum : (sum ?? 0) + p.usd), null);
  const claimed = totalUsd(history);
  const readyUsd = totalUsd(ready);
  // `ready` is one entry per stock per payout (for pricing); the headline counts payouts.
  const readyEpochs = data.vaults.reduce((n, v) => n + v.epochs.filter((e) => e.status === "published" && e.claimableAt !== null && e.claimableAt <= now).length, 0);
  const payouts = (n: number) => `${n} payout${n === 1 ? "" : "s"}`;

  // USD when a price exists; otherwise the stock amounts themselves, so devnet and unpriced stocks still read.
  const cells: { label: string; value: string; sub: string; tone?: "success"; info: string }[] = [
    {
      label: "On its way",
      info: "Payouts whose review window has ended. They're airdropped to your wallet automatically in the keeper's next run. Very small shares wait until they add up; Send now delivers them right away.",
      value: readyUsd !== null ? formatUsd(readyUsd) : (amountsText(ready) ?? "–"),
      sub: readyEpochs ? `${payouts(readyEpochs)} being airdropped` : "nothing right now",
      tone: ready.length ? "success" : undefined,
    },
    {
      label: "Building up",
      info: "Your projected share of the current period, from the fees collected so far. It's airdropped to your wallet once the period closes and the payout clears its short review.",
      // nothing harvested yet this period: show the projected share instead of a dash
      value:
        building !== null
          ? formatUsd(building)
          : (amountsText(projected) ??
            (data.projections.length === 1 ? `${(data.projections[0].sharePpm / 10_000).toFixed(data.projections[0].sharePpm % 10_000 ? 1 : 0)}% of the pot` : data.projections.length ? `${data.projections.length} coins` : "–")),
      sub: data.projections.length ? `across ${data.projections.length} coin${data.projections.length === 1 ? "" : "s"}` : "hold a coin to start",
    },
    {
      label: "Received",
      info: "Stocks already delivered to this wallet from earlier payouts.",
      value: claimed !== null ? formatUsd(claimed) : (amountsText(history) ?? "–"),
      sub: data.history.length ? payouts(data.history.length) : "no payouts yet",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {cells.map((c) => (
        <div key={c.label} className="rounded-[var(--radius-card)] border border-border bg-surface px-3 sm:px-4 py-3 min-w-0">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-faint">
            {c.label}
            <Info label={`What does ${c.label} mean?`} align="start" side="bottom">
              {c.info}
            </Info>
          </div>
          <div className={cx("text-lg sm:text-xl font-semibold tracking-tight num mt-1 truncate", c.tone === "success" && "text-success")}>{c.value}</div>
          <div className="hidden sm:block text-[11px] text-faint mt-0.5 truncate">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

const STEPS = [
  { icon: Coins, title: "Hold a coin", body: "Buy any coin launched through LINKR on StonkFun and keep it in your wallet." },
  { icon: ArrowsClockwise, title: "Its fees buy stock", body: "Creator fees are converted into the xStocks basket its creator chose." },
  { icon: Gift, title: "Get airdropped", body: "Every period the stock is split by how much you held, and for how long, and sent to your wallet." },
];

/** Shown when a wallet holds nothing yet: explain the loop, then point at the coins running it. */
function GettingStarted() {
  const { data } = useVaults({});
  const live = (data?.vaults ?? []).filter((v) => v.status === "active" && v.harvestCount > 0).slice(0, 3);
  return (
    <div className="space-y-4">
      <Card title="How stock dividends work">
        <ol className="grid sm:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <li key={s.title} className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent shrink-0">
                  <s.icon size={14} />
                </span>
                <span className="text-sm font-medium">{s.title}</span>
              </div>
              <p className="text-xs text-muted mt-2 leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </Card>
      {live.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium">Coins already paying out</h2>
            <Link href={"/vaults" as Route} className="text-xs text-accent hover:underline">
              See all
            </Link>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {live.map((v) => (
              <Link
                key={v.address}
                href={`/vaults/${v.address}` as Route}
                className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 min-w-0 transition-[border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-border-strong active:scale-[0.99]"
              >
                <CoinTile symbol={v.launch?.symbol ?? "?"} pending={false} logo={v.launch?.logo} size={36} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{v.launch?.name ?? shortAddress(v.address)}</span>
                  <span className="block text-[11px] text-faint num truncate">{v.basket.map((b) => b.symbol).join(" · ")}</span>
                </span>
                <ArrowUpRight size={14} className="ml-auto shrink-0 text-faint group-hover:text-text transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ClaimsPanel() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const program = useProgram();
  const user = publicKey?.toBase58() ?? null;
  const { data, isLoading, error, refetch } = useClaims(user);
  const now = useNow(30_000);
  const tx = useSolanaTx();
  const signed = useSignedAction();
  const toast = useToast();
  const [delivering, setDelivering] = useState<string | null>(null);

  if (!user) {
    return (
      <Card title="Your stock dividends">
        <p className="text-sm text-muted mb-3">Connect the wallet that holds the coins to see what you can claim.</p>
        <Button onClick={() => setVisible(true)}>Connect wallet</Button>
      </Card>
    );
  }
  if (error) return <Card title="Your rewards are temporarily unavailable"><p className="text-sm text-muted mb-4">The rewards service could not respond. Your wallet remains connected.</p><Button onClick={()=>refetch()}>Try again</Button></Card>;
  if (isLoading || !data) return <Skeleton className="h-40" />;

  async function claimAll(v: ClaimableVaultJson) {
    const ready = v.epochs.filter((e) => e.status === "published" && e.claimableAt !== null && e.claimableAt <= now);
    if (ready.length === 0) return;
    if (isCustodial) {
      // custodial: sign a message, the keeper transfers the stocks (it also pays for your token accounts)
      setDelivering(v.vault.address);
      try {
        const res = await signed<{ delivered: { signature: string }[] }>(`/api/claims/${user}/deliver`, "claim", v.vault.address, { vault: v.vault.address });
        toast.push({ kind: "success", title: "Payout delivered", link: explorerTxUrl(res.delivered[0]?.signature ?? "") });
        await refetch();
      } catch (e) {
        toast.push({ kind: "error", title: "Claim failed", body: (e as Error).message });
      } finally {
        setDelivering(null);
      }
      return;
    }
    const vault = new PublicKey(v.vault.address);
    const legs = v.vault.basket.map((b) => ({ mint: new PublicKey(b.mint), tokenProgram: new PublicKey(b.tokenProgram) }));
    for (let i = 0; i < ready.length; i += CLAIMS_PER_TX) {
      const batch = ready.slice(i, i + CLAIMS_PER_TX);
      await tx.run(
        async ({ payer }) => {
          const instructions = [];
          for (const e of batch) {
            instructions.push(
              ...(await claimIxs(program, {
                payer, account: payer, vault, epochId: e.epochId, amounts: e.amounts.map(BigInt), proof: e.proof.map((p) => new Uint8Array(unhex(p))), legs,
              })),
            );
          }
          return { instructions, computeUnits: 200_000 * batch.length };
        },
        `Claim ${batch.length === 1 ? `payout #${batch[0].epochId}` : `${batch.length} payouts`}`,
      );
    }
    await refetch();
  }

  const vaults = data.vaults;
  const projections = data.projections ?? [];
  return (
    <div className="space-y-6">
      <Summary data={data} now={now} />
      {vaults.length === 0 && projections.length === 0 && <GettingStarted />}
      {projections.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium inline-flex items-center gap-1">
              Building up now
              <Info label="What is building up?" align="start" side="bottom">
                Coins you hold whose current payout period is still running. Each card shows exactly when the period closes and when its stocks are airdropped.
              </Info>
            </h2>
            <p className="text-xs text-muted">Fees are being converted to stock while you hold. Nothing to do yet.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {projections.map((p) => (
              <ProjectionCard key={p.vault.address} p={p} now={now} />
            ))}
          </div>
        </section>
      )}
      {vaults.length > 0 && projections.length > 0 && (
        <h2 className="text-sm font-medium pt-2 inline-flex items-center gap-1">
          Being airdropped
          <Info label="What is being airdropped?" align="start" side="bottom">
            Published payouts. Each one is airdropped to your wallet after its short review window; the row says when.
          </Info>
        </h2>
      )}
      {vaults.length === 0 && projections.length > 0 && (
        <Card title="Nothing pending right now">
          <ul className="space-y-2 text-sm text-muted">
            {projections.map((p) => {
              const sym = p.vault.launch?.symbol ?? shortAddress(p.vault.address);
              const closed = now >= p.periodEnd;
              return (
                <li key={p.vault.address} className="leading-relaxed">
                  <span className="font-medium text-text">{sym}</span>
                  {" — "}
                  {closed ? (
                    <>
                      the period closed at {formatClock(p.periodEnd)}; the keeper is publishing the payout now. Expected in your wallet{" "}
                      <Relative target={p.claimableEstimate} past="any moment now" className="text-text" /> (≈ {formatClock(p.claimableEstimate)}).
                    </>
                  ) : p.potEmpty ? (
                    <>
                      no creator fees have come in since the last payout, so there is nothing to distribute yet. The period closes{" "}
                      <Relative target={p.periodEnd} past="now" className="text-text" />; if the pot is still empty then, it simply rolls into the next
                      window. Trades on StonkFun fill it.
                    </>
                  ) : (
                    <>
                      the current period is still running and closes <Relative target={p.periodEnd} past="now" className="text-text" /> at{" "}
                      {formatClock(p.periodEnd)}. Its stocks are expected in your wallet ≈ {formatClock(p.claimableEstimate)}.
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {vaults.map((v) => {
        const ready = v.epochs.filter((e) => e.status === "published" && e.claimableAt !== null && e.claimableAt <= now);
        const inReview = v.epochs.filter((e) => e.status === "published" && e.claimableAt !== null && e.claimableAt > now);
        const proj = projections.find((p) => p.vault.address === v.vault.address);
        return (
          <Card
            key={v.vault.address}
            title={
              <Link href={`/vaults/${v.vault.address}` as Route} className="inline-flex items-center gap-2.5 hover:underline">
                <CoinTile symbol={v.vault.launch?.symbol ?? "?"} pending={false} logo={v.vault.launch?.logo} size={28} />
                {v.vault.launch?.symbol ?? shortAddress(v.vault.address)} dividends
              </Link>
            }
            action={
              <Button size="sm" loading={tx.busy || delivering === v.vault.address} disabled={ready.length === 0} onClick={() => claimAll(v)}>
                {ready.length === 0 ? "Nothing to send yet" : `Send ${ready.length === 1 ? "it" : `${ready.length} payouts`} now`}
              </Button>
            }
          >
            {v.vault.autoClaim && (
              <p className="text-xs text-muted mb-2">Your stocks are airdropped automatically after each payout. Very small shares wait until they add up; Send now delivers them right away.</p>
            )}
            {(() => {
              // the payout in review, else the one being airdropped right now
              const current = inReview[0] ?? ready[0];
              if (!current || current.claimableAt === null) return null;
              const publishedAt = Math.min(Math.floor(Date.parse(current.createdAt) / 1000), current.claimableAt);
              return (
                <div className="mb-3 rounded-lg border border-border/60 bg-surface-2/40 px-3 py-3">
                  <PayoutClock
                    periodStart={current.periodStart}
                    periodEnd={current.periodEnd}
                    keeperLag={proj?.keeperLag ?? PUBLISH_LAG_S}
                    disputeWindow={current.claimableAt - publishedAt}
                    publishedAt={publishedAt}
                    claimableAt={current.claimableAt}
                    compact
                  />
                </div>
              );
            })()}
            <ul className="divide-y divide-border/60 text-sm">
              {v.epochs.map((e) => (
                <li key={e.epochId} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="num">
                    #{e.epochId} · {e.tokens.map((t, i) => fmtToken(e.amounts[i], t)).join(" + ")}
                  </span>
                  {e.status === "computed" ? (
                    <span className="inline-flex items-center gap-1">
                      <Badge tone="warn">publishing…</Badge>
                      <Info label="What does publishing mean?" align="end">
                        The keeper has computed this payout and is writing it on-chain. It takes about a minute.
                      </Info>
                    </span>
                  ) : e.claimableAt !== null && e.claimableAt > now ? (
                    <span className="inline-flex items-center gap-1">
                      <Badge tone="warn" title={formatClock(e.claimableAt, { date: true })}>
                        in review · airdrop <Relative target={e.claimableAt} past="now" /> at {formatClock(e.claimableAt)}
                      </Badge>
                      <Info label="What is the review window?" align="end">
                        A short pause after publishing during which a payout that looks wrong can be cancelled and rolled into the next one. Once it ends the stocks are airdropped, at the time shown.
                      </Info>
                    </span>
                  ) : (
                    <Badge tone="success">airdropping</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {data.history.length > 0 && (
        <Card title="Claim history">
          <ul className="divide-y divide-border/60 text-sm">
            {data.history.map((h) => (
              <li key={h.signature + h.epochId} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="num">
                  <Link href={`/vaults/${h.vault}` as Route} className="hover:underline">
                    {shortAddress(h.vault)}
                  </Link>{" "}
                  #{h.epochId} · {h.tokens.map((t, i) => fmtToken(h.amounts[i], t)).join(" + ")}
                </span>
                <span className="text-xs text-muted">
                  {timeAgo(h.timestamp)} ·{" "}
                  <a href={explorerTxUrl(h.signature)} target="_blank" rel="noreferrer" className="hover:text-text">
                    tx
                    <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5 opacity-60" />
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
