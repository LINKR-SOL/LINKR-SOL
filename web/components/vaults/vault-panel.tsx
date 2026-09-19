"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { explorerAddressUrl, explorerTxUrl, isCustodial, isMainnet } from "@/lib/solana/cluster";
import { coinUrl } from "@/lib/token";
import { useHarvestQuote, useVault, useVaultConfig, useVaultEpochs, useVaultHarvests } from "@/lib/hooks/useApi";
import { useNow } from "@/lib/hooks/useNow";
import { useSolanaTx } from "@/lib/hooks/useSolanaTx";
import { useSignedAction } from "@/lib/hooks/useSignedAction";
import { useProgram } from "@/lib/hooks/useProgram";
import { cancelEpochIx, harvestIntakeIx, setAutoClaimIx } from "@/lib/solana/ix";
import { formatAmount, formatSol, formatUsd, parseAmount, shortAddress, timeAgo, toShares, usdOf } from "@/lib/format";
import type { EpochJson, TokenJson } from "@/lib/api-types";
import { ArrowRight, ArrowUpRight } from "@/components/ui/icons";
import { TokenIcon } from "@/components/token-icon";
import { AmountInput, Badge, Button, Callout, Card, EmptyState, Stat, cx } from "@/components/ui/primitives";
import { vaultBadge } from "./vaults-list";
import { VaultSkeleton } from "./vault-skeleton";
import { Info } from "@/components/ui/info";
import { formatClock } from "@/lib/format";
import { DevnetTrade } from "./devnet-trade";
import { BindingClock } from "./binding-clock";
import { Countdown, Relative } from "@/components/ui/live-time";
import { PUBLISH_LAG_S, fmtDuration, reviewWindowFor } from "@/lib/launch/options";
import { PayoutClock } from "./payout-clock";

export function fmtToken(raw: string | bigint, t: TokenJson) {
  return `${fmtAmountOnly(raw, t)} ${t.symbol}`;
}

/** Same number without the ticker: in a table the row already says which stock it is. */
export function fmtAmountOnly(raw: string | bigint, t: TokenJson) {
  return `${formatAmount(toShares(BigInt(raw), t.scaledUi?.multiplier), t.decimals)}${t.scaledUi ? " sh" : ""}`;
}

export function countdown(target: number, now: number): string {
  const d = target - now;
  if (d <= 0) return "now";
  if (d < 3_600) return `${Math.ceil(d / 60)} min`;
  if (d < 86_400) return `${Math.floor(d / 3_600)} h ${Math.ceil((d % 3_600) / 60)} min`;
  return `${Math.floor(d / 86_400)} d ${Math.floor((d % 86_400) / 3_600)} h`;
}

export function epochBadge(e: EpochJson, now: number) {
  if (e.status === "computed") return <Badge tone="warn">publishing…</Badge>;
  if (e.status === "cancelled") return <Badge>cancelled</Badge>;
  if (e.status === "expired") return <Badge>expired</Badge>;
  if (e.claimableAt !== null && e.claimableAt > now) return <Badge tone="warn">in review · airdrop <Relative target={e.claimableAt} past="now" /></Badge>;
  const delivered = e.amounts.every((a, i) => BigInt(a) <= BigInt(e.claimedTotals[i] ?? "0"));
  return delivered ? <Badge tone="success">airdropped</Badge> : <Badge tone="success">airdropping</Badge>;
}

export function VaultPanel({ address }: { address: string }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const program = useProgram();
  const user = publicKey?.toBase58() ?? null;
  const { data: vault, isLoading, error, refetch } = useVault(address);
  const { data: epochsData, refetch: refetchEpochs } = useVaultEpochs(address);
  const { data: harvestsData } = useVaultHarvests(address);
  const { data: vcfg } = useVaultConfig();
  const now = useNow(30_000);
  const tx = useSolanaTx();
  const signed = useSignedAction();
  const [acting, setActing] = useState(false);
  const [simAmount, setSimAmount] = useState("");
  const isCreator = !!user && !!vault && user === vault.creator;
  const isAdmin = !!user && !!vcfg && user === vcfg.admin;
  const active = vault?.status === "active";
  const gross = vault ? BigInt(vault.creatorVaultBalance) + BigInt(vault.idleQuote) : 0n;
  /** fees are in the coin's quote: SOL for most coins, the stock or stablecoin it was quoted in otherwise */
  const fmtQuote = (raw: bigint | string) => (vault && vault.quote.mint !== "So11111111111111111111111111111111111111112" ? `${formatAmount(raw, vault.quote.decimals)} ${vault.quote.symbol}` : formatSol(raw));
  const { data: quote, error: quoteError } = useHarvestQuote(address, isCreator && active && gross > 0n);

  if (error) return <EmptyState title="Vault not found" action={{ href: "/vaults" as Route, label: "All vaults" }} />;
  if (isLoading || !vault) return <VaultSkeleton />;

  const epochs = epochsData?.epochs ?? [];
  const harvests = harvestsData?.harvests ?? [];
  const latest = epochs.find((e) => e.epochId === vault.epochCount);
  const canCancel = !!latest && latest.status === "published" && latest.claimableAt !== null && latest.claimableAt > now && (isCreator || isAdmin);
  const vaultKey = new PublicKey(vault.address);
  const legs = vault.basket.map((b) => ({ mint: new PublicKey(b.mint), tokenProgram: new PublicKey(b.tokenProgram) }));

  const v = vault;
  /** custodial: the wallet signs a message and the keeper does the work; program: the creator's own transaction */
  async function custodial(action: "harvest" | "autoclaim" | "cancel", extra: Record<string, unknown> = {}) {
    setActing(true);
    try {
      await signed(`/api/vaults/${v.address}/actions`, action, v.address, extra);
      await Promise.all([refetch(), refetchEpochs()]);
    } finally {
      setActing(false);
    }
  }
  async function onHarvest() {
    if (!vcfg) return;
    if (isCustodial) return custodial("harvest");
    await tx.run(async ({ payer }) => {
      // program mode: StonkFun forwards fees straight onto the PDA, so the intake is the whole harvest
      const intake = await harvestIntakeIx(program, {
        caller: payer, vault: vaultKey, quoteMint: new PublicKey(v.quote.mint), quoteTokenProgram: new PublicKey(v.quote.tokenProgram),
        protocolRecipient: new PublicKey(vcfg.protocolRecipient), legs,
      });
      return { instructions: intake };
    }, "Harvest fees");
    await Promise.all([refetch(), refetchEpochs()]);
  }
  async function onToggleAutoClaim() {
    if (isCustodial) return custodial("autoclaim", { enabled: !v.autoClaim });
    await tx.run(async ({ payer }) => ({ instructions: [await setAutoClaimIx(program, payer, vaultKey, !v.autoClaim)] }), v.autoClaim ? "Turn off automatic delivery" : "Turn on automatic delivery");
    await refetch();
  }
  async function onCancel() {
    if (!latest) return;
    if (isCustodial) return custodial("cancel", { epochId: latest.epochId });
    await tx.run(async ({ payer }) => ({ instructions: [await cancelEpochIx(program, payer, vaultKey, latest.epochId)] }), `Cancel payout #${latest.epochId}`);
    await Promise.all([refetch(), refetchEpochs()]);
  }
  async function onSimulateFees() {
    const v = parseAmount(simAmount, 9);
    if (v === null || v === 0n) return;
    // StonkFun forwards creator fees to the vault wallet as plain lamports; a transfer does exactly the same
    await tx.run(({ payer }) => ({ instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: vaultKey, lamports: v })] }), "Simulate creator fees");
    setSimAmount("");
    await refetch();
  }

  const nextEpochAt = vault.nextEpochAt;
  // the review window this vault's payouts wait before the airdrop (custodial: sized to the payout period)
  const review = vcfg ? (isCustodial ? reviewWindowFor(vault.epochLength, vcfg.disputeWindow) : vcfg.disputeWindow) : null;
  // a published payout still on its way to wallets: in review, or airdropping and not fully delivered yet
  const onTheWay =
    latest && latest.status === "published" && latest.claimableAt !== null && latest.amounts.some((a, i) => BigInt(a) > BigInt(latest.claimedTotals[i] ?? "0")) && now < latest.claimableAt + 15 * 60
      ? latest
      : null;
  const pendingSwapTotal = vault.basket.reduce((s, b) => s + BigInt(b.pendingSwap), 0n);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{vault.launch?.symbol ? `${vault.launch.symbol} dividends` : "Dividend vault"}</h1>
          <div className="mt-1 text-sm text-muted flex flex-wrap items-center gap-2">
            <a href={explorerAddressUrl(vault.address)} target="_blank" rel="noreferrer" className="num hover:text-text">
              {shortAddress(vault.address, 6)}
              <ArrowUpRight size={13} className="inline align-[-1px] ml-0.5 opacity-60" />
            </a>
            <span className="text-faint">·</span>
            <span>
              by {shortAddress(vault.creator)}
              {isCreator ? " (you)" : ""}
            </span>
            <span className="text-faint">·</span>
            <span>{timeAgo(vault.createdAt)}</span>
            {vaultBadge(vault)}
            {vault.autoClaim && <Badge tone="success">airdrops</Badge>}
          </div>
        </div>
        <Link href={"/claims" as Route} className="inline-flex h-10 items-center rounded-lg bg-surface-2 border border-border px-4 text-sm font-medium hover:border-border-strong">
          My claims
          <ArrowRight size={15} className="ml-1.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Coin"
          value={<span className="text-sm">{vault.launch?.symbol ?? (vault.status === "pending" ? "not launched" : "…")}</span>}
          sub={
            vault.launchMint ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <a href={explorerAddressUrl(vault.launchMint)} target="_blank" rel="noreferrer" className="num hover:text-text">
                  {shortAddress(vault.launchMint)}
                  <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5 opacity-60" />
                </a>
                <a
                  href={coinUrl(vault.launchMint)}
                  target="_blank"
                  rel="noreferrer"
                  title={isMainnet ? "Open this coin on StonkFun" : "StonkFun lists mainnet coins only; open this devnet coin on Solscan"}
                  className="venue-link"
                >
                  {isMainnet ? "StonkFun" : "Solscan"}
                  <ArrowUpRight size={11} />
                </a>
              </span>
            ) : (
              "waiting for the launch"
            )
          }
        />
        <Stat
          label="Fees waiting"
          info={
            <Info label="What are fees waiting?" align="start" side="bottom">
              Creator fees this vault has earned (0.5% of every trade) that the keeper has not yet harvested and swapped into the stock basket. Harvest happens automatically once it passes a small threshold.
            </Info>
          }
          value={<span className="num text-sm">{fmtQuote(gross)}</span>}
          sub={BigInt(vault.creatorVaultBalance) > 0n ? `${fmtQuote(vault.creatorVaultBalance)} accrued on chain, not yet claimed` : `paid in ${vault.quote.symbol}`}
        />
        <Stat
          label="Payouts"
          info={
            <Info label="What is a payout?" align="start" side="bottom">
              Each period ends with one payout: the stocks bought with that period&apos;s fees, split between holders by how much they held and for how long.
            </Info>
          }
          value={vault.epochCount}
          sub={`every ${fmtDuration(vault.epochLength)}`}
        />
        <Stat
          label="Next payout"
          info={
            <Info label="When do holders get their stocks?" align="end" side="bottom">
              The period closes at the time shown. The keeper then needs about a minute to publish, followed by a {review !== null ? fmtDuration(review) : "short"} review window, and then every holder&apos;s stocks are airdropped to their wallet.
            </Info>
          }
          value={nextEpochAt ? <span className="text-sm"><Relative target={nextEpochAt} past="closing now" /></span> : "–"}
          sub={
            nextEpochAt
              ? `closes ${formatClock(nextEpochAt, { date: true })} · airdropped ≈ ${formatClock(nextEpochAt + 90 + (review ?? 0) + 60)}`
              : "after the launch is bound"
          }
        />
      </div>

      {active && nextEpochAt && vcfg && (
        <section className="rounded-xl border border-border bg-surface px-4 py-4" aria-label="Next payout">
          <h2 className="mb-3 text-sm font-medium">{onTheWay ? `Payout #${onTheWay.epochId}` : "Next payout"}</h2>
          {onTheWay && onTheWay.claimableAt !== null ? (
            <PayoutClock
              periodStart={onTheWay.periodStart}
              periodEnd={onTheWay.periodEnd}
              keeperLag={PUBLISH_LAG_S}
              disputeWindow={Math.max(0, onTheWay.claimableAt - Math.floor(Date.parse(onTheWay.createdAt) / 1000))}
              publishedAt={Math.min(Math.floor(Date.parse(onTheWay.createdAt) / 1000), onTheWay.claimableAt)}
              claimableAt={onTheWay.claimableAt}
            />
          ) : (
            <PayoutClock
              periodStart={nextEpochAt - vault.epochLength}
              periodEnd={nextEpochAt}
              keeperLag={PUBLISH_LAG_S}
              disputeWindow={review ?? 0}
              potEmpty={vault.basket.every((b) => BigInt(b.unallocated) === 0n)}
            />
          )}
        </section>
      )}

      {vault.status === "pending" && vault.pendingLaunch && (
        <Callout tone="success">
          <span className="font-medium">{vault.pendingLaunch.symbol} has launched.</span> The keeper is binding it to this vault — usually within a couple of
          minutes, and this page updates on its own. <span className="text-faint">Do not launch again; a second launch would create a separate coin.</span>
        </Callout>
      )}
      {vault.status === "pending" && vault.pendingLaunch && (
        <BindingClock launchedAt={vault.pendingLaunch.launchedAt} epochLength={vault.epochLength} symbol={vault.pendingLaunch.symbol} />
      )}
      {vault.status === "pending" && !vault.pendingLaunch && (
        <Callout tone="warn">
          This vault has no coin bound yet. The keeper binds it automatically once the coin this vault was created for launches on StonkFun with the vault
          as its creator.{" "}
          {isCreator && (
            <Link href={`/launch?vault=${vault.address}&mint=${vault.expectedMint}` as Route} className="underline">
              Launch the coin now
            </Link>
          )}
          {!isCreator && <span className="num">Vault: {vault.address}</span>}
        </Callout>
      )}
      {vault.status === "pending" && !vault.pendingLaunch && (
        <BindingClock launchedAt={null} epochLength={vault.epochLength} launchHref={isCreator ? (`/launch?vault=${vault.address}&mint=${vault.expectedMint}` as Route) : undefined} />
      )}
      {!isMainnet && active && (
        <Callout tone="info">
          Devnet: nobody else trades this coin, so fees only accrue when you do. Buy or sell below to generate creator fees (0.3% of every trade),
          and trade from a second wallet to see a payout split between holders.
        </Callout>
      )}
      {!isMainnet && active && vault.launchMint && (
        <DevnetTrade mint={vault.launchMint} symbol={vault.launch?.symbol ?? shortAddress(vault.launchMint)} quote={{ mint: vault.quote.mint, tokenProgram: vault.quote.tokenProgram, decimals: vault.quote.decimals, symbol: vault.quote.symbol }} />
      )}
      {pendingSwapTotal > 0n && (
        <Callout tone="info">
          {formatSol(pendingSwapTotal)} of harvested fees is reserved for swaps; the keeper converts it into the basket leg by leg within a few minutes.
        </Callout>
      )}

      <Card
        title="Basket"
        action={
          vcfg ? (
            <span className={cx("text-xs", vcfg.protocolShareBps === 0 ? "text-success" : "text-muted")}>
              {vcfg.protocolShareBps === 0 ? "0% platform fee — every harvested fee goes to holders" : `LINKR keeps ${vcfg.protocolShareBps / 100}% of harvested fees`}
            </span>
          ) : undefined
        }
      >
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-faint">
                <th className="text-left font-medium px-3 pb-2">Stock</th>
                <th className="text-right font-medium px-3 pb-2">Bought</th>
                <th className="text-right font-medium px-3 pb-2">Next payout</th>
                <th className="text-right font-medium px-3 pb-2">Claimable</th>
              </tr>
            </thead>
            <tbody>
              {vault.basket.map((b) => (
                <tr key={b.mint} className="border-t border-border/60 [&>td]:border-t [&>td]:border-border/60">
                  <td className="px-3 py-3.5">
                    <span className="flex items-center gap-2.5">
                      <TokenIcon symbol={b.symbol} address={b.mint} logoUrl={b.logoUrl} size={22} />
                      <span className="font-medium">{b.symbol}</span>
                      <span className="text-faint text-xs num">{b.weightBps / 100}%</span>
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-right num text-muted whitespace-nowrap">{fmtAmountOnly(b.harvestedTotal, b)}</td>
                  <td className="px-3 py-3.5 text-right num text-muted whitespace-nowrap">
                    {fmtAmountOnly(b.unallocated, b)}
                    {b.pendingSwap !== "0" && <span className="block text-[11px] text-warn">+ {formatSol(b.pendingSwap)} to swap</span>}
                  </td>
                  <td className="px-3 py-3.5 text-right num text-muted whitespace-nowrap">{fmtAmountOnly(b.allocated, b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {active && (
        <Card title="Creator actions" action={<span className="text-xs text-muted">the keeper does all of this automatically</span>}>
          {!user ? (
            <Button onClick={() => setVisible(true)}>Connect wallet</Button>
          ) : (
            <div className="space-y-3">
              {isCreator && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button loading={tx.busy} disabled={!quote || gross === 0n} onClick={onHarvest}>
                    Harvest now
                  </Button>
                  <span className="text-xs text-muted">
                    {gross === 0n
                      ? "nothing to harvest"
                      : quote
                        ? `≈ ${quote.legs.filter((l) => l.swap || l.amountIn !== "0").map((l) => (l.swap && l.quote !== "0" ? fmtToken(l.quote, l.token) : `${formatSol(l.amountIn)} → ${l.token.symbol}`)).join(" + ")} after the ${quote.slippageBps / 100}% slippage guard${quote.gross !== quote.available ? ` (converting ${formatSol(quote.gross)} of ${formatSol(quote.available)}: the pools are thin, the rest waits)` : ""}`
                        : quoteError
                          ? `quote failed: ${quoteError.message}`
                          : "quoting…"}
                  </span>
                </div>
              )}
              {isCreator && !isCustodial && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" loading={tx.busy || acting} onClick={onToggleAutoClaim}>
                    {vault.autoClaim ? "Turn off automatic delivery" : "Turn on automatic delivery"}
                  </Button>
                  <span className="text-xs text-muted">
                    {vault.autoClaim
                      ? `on: the keeper sends each holder their stocks ${vcfg ? Math.round(vcfg.autoClaim.delaySeconds / 60) : 10} min after a payout opens and retries every ${vcfg ? Math.round(vcfg.autoClaim.retrySeconds / 60) : 30} min${vcfg && vcfg.autoClaim.minUsd > 0 ? `; shares under $${vcfg.autoClaim.minUsd} wait and accumulate` : ""}`
                      : "off: holders claim on the Claims page"}
                    {vcfg && !vcfg.autoClaim.enabled && " · disabled by the operator right now"}
                  </span>
                </div>
              )}
              {canCancel && latest && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="danger" loading={tx.busy || acting} onClick={onCancel}>
                    Cancel payout #{latest.epochId}
                  </Button>
                  <span className="text-xs text-muted">only during the review window (<Countdown target={latest.claimableAt!} /> left); funds return to the next payout</span>
                </div>
              )}
              {!isCreator && !canCancel && <p className="text-sm text-muted">Only the creator can harvest manually.</p>}
              {!isMainnet && (
                <div className="pt-3 border-t border-border/60">
                  <div className="text-xs text-faint uppercase tracking-wider mb-2">Simulate creator fees (devnet)</div>
                  <AmountInput
                    value={simAmount}
                    onChange={setSimAmount}
                    placeholder="amount in SOL"
                    right={
                      <Button size="sm" variant="secondary" loading={tx.busy} disabled={!parseAmount(simAmount, 9)} onClick={onSimulateFees}>
                        Credit vault
                      </Button>
                    }
                    below={<span>Sends SOL to the vault wallet, exactly where StonkFun&apos;s fee forwarding lands it.</span>}
                  />
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Fee conversions" action={<span className="text-xs text-muted">creator fees swapped into the basket</span>}>
        {harvests.length === 0 ? (
          <p className="text-sm text-faint">
            Nothing converted yet. Fees accrue on StonkFun as the coin trades, and are swapped into the basket once they clear the threshold.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {harvests.map((h) => {
              const bought = h.legs.reduce((sum, l) => {
                const u = l.amountOut ? usdOf(l.amountOut, l.token.decimals, l.token.priceUsd) : null;
                return u === null ? sum : sum + u;
              }, 0);
              return (
                <li key={h.signature} className="py-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium num">
                      {formatSol(h.input)} in
                      {bought > 0 && (
                        <span className="text-muted">
                          <ArrowRight size={12} className="inline align-[-1px] mx-1" aria-hidden="true" />
                          {formatUsd(bought)} of stock
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted">
                      {timeAgo(h.timestamp)} ·{" "}
                      <a href={explorerTxUrl(h.signature)} target="_blank" rel="noreferrer" className="hover:text-text">
                        tx
                        <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5 opacity-60" />
                      </a>
                    </span>
                  </div>
                  <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
                    {h.legs.map((l) => (
                      <span key={l.token.mint} className="num">
                        {l.amountOut ? fmtToken(l.amountOut, l.token) : `${formatSol(l.amountIn)} → ${l.token.symbol} (swap pending)`}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Payouts" action={<span className="text-xs text-muted">time-weighted by holding over each period</span>}>
        {epochs.length === 0 ? (
          <p className="text-sm text-faint">No payout yet. The first one is computed after the first full period with harvested stocks.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {epochs.map((e) => (
              <li key={e.epochId} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    #{e.epochId} · {new Date(e.periodStart * 1000).toLocaleDateString()} – {new Date(e.periodEnd * 1000).toLocaleDateString()}
                  </span>
                  {epochBadge(e, now)}
                </div>
                <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
                  <span>{e.holderCount} holders</span>
                  {e.tokens.map((t, i) => (
                    <span key={t.mint} className="num">
                      {fmtToken(e.amounts[i], t)}
                      {e.claimedTotals[i] !== "0" && <span className="text-faint"> ({fmtToken(e.claimedTotals[i], t)} claimed)</span>}
                    </span>
                  ))}
                  <a href={`/api/vaults/${vault.address}/epochs/${e.epochId}/leaves`} target="_blank" rel="noreferrer" className="hover:text-text">
                    per-holder data
                    <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5 opacity-60" />
                  </a>
                  {e.publishedSignature && (
                    <a href={explorerTxUrl(e.publishedSignature)} target="_blank" rel="noreferrer" className="hover:text-text">
                      tx
                      <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5 opacity-60" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
