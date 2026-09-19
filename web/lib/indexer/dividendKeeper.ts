import { PublicKey, SystemProgram, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createSyncNativeInstruction } from "@solana/spl-token";
import { activeCluster, envValue, isCustodial, PROGRAM_ID } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { keeperKeypair, KeypairWallet } from "../solana/keeper";
import {
  ata,
  big,
  bn,
  claimPda,
  configPda,
  epochPda,
  TOKEN_PROGRAM_ID,
  walletProgram,
} from "../solana/program";
import { anchorErrorName, sendKeeperTx } from "../solana/send";
import { harvestIntakeIx } from "../solana/ix";
import { fetchLaunchpadPoolFor } from "../launchlab/pool";
import { swapInstructions } from "../jupiter/client";
import { collections, ensureIndexes } from "../db/collections";
import type { EpochLeafDoc, VaultDoc } from "../db/types";
import { unhex } from "../dividends/merkle";
import { buildEpoch, persistEpoch } from "./epochBuild";
import { quoteSizedHarvest, swapMode } from "../dividends/quote";
import { formatUnits, parseUnits } from "../format";
import { refreshVaults } from "./refresh";
import { syncAllBalanceStreams, type StreamReport } from "./balances";
import { ingestTx } from "./txIngest";

/**
 * The dividend keeper. Runs from /api/cron/dividends under a Mongo lease and, per vault:
 *  1. binds launches whose pool `creator` is the vault (permissionless, but somebody has to pay the fee);
 *  2. advances the coin's balance stream;
 *  3. harvests once enough fees have accrued (StonkFun forwards them onto the PDA): runs `harvest_intake`,
 *     then swaps each reserved leg (Jupiter, keeper-signed) between `swap_begin` and `swap_settle`;
 *  4. when an epoch period has elapsed, computes time-weighted holder balances, builds the Merkle tree, stores
 *     leaves + proofs + the end-of-period snapshot, and publishes the root;
 *  5. expires epochs whose claim window closed so unclaimed stock rolls into the next epoch;
 *  6. delivers claims for holders of vaults whose creator opted in.
 * Everything is keyed so a crash between steps is harmless: the next run recomputes and the program rejects
 * duplicates (period_start must equal last_period_end; claim-status PDAs exist once).
 */

const cluster = activeCluster;
const LOCK_ID = `dividends:${cluster}`;
const MAX_CLAIMS_PER_TX = 4;

export interface DividendKeeperReport {
  enabled: boolean;
  reason?: string;
  operator?: string;
  vaults: number;
  bound: { vault: string; mint: string; signature: string }[];
  streams: StreamReport[];
  harvested: { vault: string; input: string; signature: string; swaps: { leg: number; out: string; signature: string }[] }[];
  published: { vault: string; epochId: number; holders: number; signature: string }[];
  expired: { vault: string; epochId: number; signature: string }[];
  /** keeper-paid deliveries (creator opted in via set_auto_claim) */
  delivered: { vault: string; account: string; epochs: number[]; signature: string }[];
  skipped: { vault: string; step: string; reason: string }[];
  ms: number;
}

/** Auto-delivery policy (operator side; the creator's per-vault switch is on chain). */
export function autoClaimPolicy() {
  return {
    enabled: (process.env.DIVIDEND_AUTOCLAIM ?? "on").toLowerCase() !== "off",
    minUsd: envNumber("DIVIDEND_AUTOCLAIM_MIN_USD", 1),
    delaySeconds: envNumber("DIVIDEND_AUTOCLAIM_DELAY_S", 0),
    retrySeconds: envNumber("DIVIDEND_AUTOCLAIM_RETRY_S", 1800),
    maxPerRun: envNumber("DIVIDEND_AUTOCLAIM_MAX_PER_RUN", 50),
  };
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

const short = (e: unknown) => (anchorErrorName(e) ?? String((e as Error)?.message ?? e)).slice(0, 160);

export async function acquireLease(owner: string, ttlMs: number): Promise<boolean> {
  const c = await collections();
  const now = new Date();
  try {
    const res = await c.locks.updateOne({ _id: LOCK_ID, expiresAt: { $lt: now } }, { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs) } }, { upsert: true });
    return res.matchedCount > 0 || res.upsertedCount > 0;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false; // held by someone else
    throw e;
  }
}

export async function releaseLease(owner: string): Promise<void> {
  const c = await collections();
  await c.locks.updateOne({ _id: LOCK_ID, owner }, { $set: { expiresAt: new Date(0) } });
}

export async function runDividendKeeper(opts: { budgetMs?: number } = {}): Promise<DividendKeeperReport> {
  // custodial deployments run the keeper in lib/custody (dynamic import: it shares this module's lease + types)
  if (isCustodial) return (await import("../custody/keeper")).runCustodialKeeper(opts);
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  const report: DividendKeeperReport = {
    enabled: false, vaults: 0, bound: [], streams: [], harvested: [], published: [], expired: [], delivered: [], skipped: [], ms: 0,
  };
  const maybeKeeper = keeperKeypair();
  if (!maybeKeeper) return { ...report, reason: "KEEPER_PRIVATE_KEY not set", ms: Date.now() - started };
  const keeper: Keypair = maybeKeeper;
  await ensureIndexes();
  const c = await collections();
  const connection = serverConnection();
  const program = walletProgram(connection, new KeypairWallet(keeper));
  const owner = `${keeper.publicKey.toBase58()}:${started}`;
  if (!(await acquireLease(owner, budgetMs + 30_000))) {
    return { ...report, reason: "another keeper run holds the lease", ms: Date.now() - started };
  }
  report.enabled = true;
  report.operator = keeper.publicKey.toBase58();
  const remaining = () => budgetMs - (Date.now() - started);
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PROGRAM_ID)[0];
  const config = configPda();

  try {
    const cfg = await program.account.config.fetch(config);
    const isOperator = cfg.operator.equals(keeper.publicKey);
    const vaults = await c.vaults.find({ cluster, programId: PROGRAM_ID.toBase58() }).toArray();
    report.vaults = vaults.length;

    // 1. bind pending vaults
    for (const v of vaults.filter((x) => x.status === "pending")) {
      if (remaining() < 20_000) break;
      try {
        const mint = new PublicKey(v.expectedMint);
        const pool = await fetchLaunchpadPoolFor(connection, mint, new PublicKey(v.quoteMint)).catch(() => null);
        if (!pool || pool.creator !== v.address) continue;
        // the deployed program's bind_launch still parses pump.fun's curve account; a LaunchLab-aware build is the
        // program-mode follow-up (docs/ARCHITECTURE.md). Until then the pool account is handed over as-is.
        const ix = await program.methods.bindLaunch().accountsStrict({ vault: new PublicKey(v.address), bondingCurve: new PublicKey(pool.address), eventAuthority, program: PROGRAM_ID }).instruction();
        const { signature } = await sendKeeperTx(connection, keeper, [ix], { computeUnits: 100_000 });
        await ingestTx(signature);
        report.bound.push({ vault: v.address, mint: v.expectedMint, signature });
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "bind", reason: short(e) });
      }
    }

    // 2. balance streams (half of what is left, capped)
    report.streams = await syncAllBalanceStreams(Math.min(Math.max(remaining() / 2, 5_000), 90_000));

    // fresh chain state for every active vault
    const active = (await c.vaults.find({ cluster, programId: PROGRAM_ID.toBase58(), status: "active" }).toArray()).filter((v) => v.launchMint);
    if (active.length === 0) return report;
    const states = await program.account.vault.fetchMultiple(active.map((v) => new PublicKey(v.address)));
    const minHarvest = parseUnits(process.env.DIVIDEND_MIN_HARVEST ?? "0.001", 9);
    const slippageBps = envNumber("DIVIDEND_MAX_SLIPPAGE_BPS", 100);
    const now = Math.floor(Date.now() / 1000);

    for (let i = 0; i < active.length; i++) {
      const v = active[i];
      const s = states[i];
      if (!s) {
        report.skipped.push({ vault: v.address, step: "state", reason: "vault account not found" });
        continue;
      }
      const vaultKey = new PublicKey(v.address);
      if (!isOperator && !s.creator.equals(keeper.publicKey)) {
        report.skipped.push({ vault: v.address, step: "harvest", reason: "keeper is neither operator nor creator" });
        continue;
      }
      const legs = s.legs.map((l) => ({ mint: l.mint, tokenProgram: l.tokenProgram, decimals: l.decimals, weightBps: l.weightBps, pendingSwap: big(l.pendingSwap), unallocated: big(l.unallocated) }));
      const quoteMint = s.quoteMint;
      const quoteProgram = s.quoteTokenProgram;
      const vaultQuoteAta = ata(vaultKey, quoteMint, quoteProgram);
      const legAtas = legs.map((l) => ata(vaultKey, l.mint, l.tokenProgram));

      // 3a. intake: forwarded fees on the PDA → wrap + reserve per leg. (LaunchLab's on-chain creator fee needs the
      //     creator's signature to claim, which a PDA cannot give; program mode relies on StonkFun's forwarding.)
      try {
        if (remaining() < 30_000) break;
        const [creatorVault, lamports, quoteAcc] = await Promise.all([
          Promise.resolve(0n),
          connection.getBalance(vaultKey),
          connection.getTokenAccountBalance(vaultQuoteAta).then((r) => BigInt(r.value.amount)).catch(() => 0n),
        ]);
        const rent = await connection.getMinimumBalanceForRentExemption((await connection.getAccountInfo(vaultKey))?.data.length ?? 0);
        let accounted = 0n;
        for (const l of legs) {
          if (l.mint.equals(quoteMint)) accounted += l.unallocated + big(s.legs[legs.indexOf(l)].allocated);
          accounted += l.pendingSwap;
        }
        const idle = BigInt(Math.max(0, lamports - rent)) + (quoteAcc > accounted ? quoteAcc - accounted : 0n);
        const gross = creatorVault + idle;
        if (gross >= minHarvest) {
          const ixs: TransactionInstruction[] = [];
          ixs.push(
            ...(await harvestIntakeIx(program, {
              caller: keeper.publicKey, vault: vaultKey, quoteMint, quoteTokenProgram: quoteProgram, protocolRecipient: cfg.protocolRecipient,
              legs: legs.map((l) => ({ mint: l.mint, tokenProgram: l.tokenProgram })),
            })),
          );
          const { signature } = await sendKeeperTx(connection, keeper, ixs, { computeUnits: 400_000 });
          await ingestTx(signature);
          report.harvested.push({ vault: v.address, input: formatUnits(gross, 9), signature, swaps: [] });
          // re-read the legs so the swap step sees the reservations
          const fresh = await program.account.vault.fetch(vaultKey);
          fresh.legs.forEach((l, k) => (legs[k].pendingSwap = big(l.pendingSwap)));
        }
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "harvest", reason: short(e) });
      }

      // 3b. swaps: one transaction per leg, begin -> Jupiter -> settle
      if (swapMode() !== "off") {
        for (let leg = 0; leg < legs.length; leg++) {
          const l = legs[leg];
          if (l.pendingSwap === 0n || l.mint.equals(quoteMint)) continue;
          if (remaining() < 30_000) break;
          try {
            const { quote } = await quoteSizedHarvest({
              quoteMint: quoteMint.toBase58(), gross: l.pendingSwap, basket: [{ mint: l.mint.toBase58(), weightBps: 10_000 }],
              protocolShareBps: 0, slippageBps, floor: 1n,
            });
            const q = quote.legs[0];
            if (q.amountIn !== l.pendingSwap) {
              report.skipped.push({ vault: v.address, step: "swap", reason: `leg ${leg}: venue only absorbs ${q.amountIn} of ${l.pendingSwap}; waiting` });
              continue;
            }
            const keeperQuoteAta = ata(keeper.publicKey, quoteMint, quoteProgram);
            const ixs: TransactionInstruction[] = [
              createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, keeperQuoteAta, keeper.publicKey, quoteMint, quoteProgram),
              await program.methods
                .swapBegin(leg)
                .accountsStrict({
                  operator: keeper.publicKey, config, vault: vaultKey, quoteMint, vaultQuoteAta, operatorQuoteAta: keeperQuoteAta, legMint: l.mint,
                  vaultLegAta: legAtas[leg], legTokenProgram: l.tokenProgram, quoteTokenProgram: quoteProgram,
                  instructionsSysvar: new PublicKey("Sysvar1nstructions1111111111111111111111111"), eventAuthority, program: PROGRAM_ID,
                })
                .instruction(),
            ];
            let lookupTables: import("@solana/web3.js").AddressLookupTableAccount[] = [];
            if (swapMode() === "mock") {
              // devnet: the keeper is the basket mint's authority and mints the quoted amount straight into the vault
              ixs.push(createMintToInstruction(l.mint, legAtas[leg], keeper.publicKey, q.quote, [], l.tokenProgram));
            } else {
              const sw = await swapInstructions(connection, q.jupiter!, { userPublicKey: keeper.publicKey, destinationTokenAccount: legAtas[leg] });
              ixs.push(...sw.instructions);
              lookupTables = sw.lookupTables;
            }
            ixs.push(
              await program.methods
                .swapSettle(leg, bn(q.minOut))
                .accountsStrict({ operator: keeper.publicKey, config, vault: vaultKey, legMint: l.mint, vaultLegAta: legAtas[leg], legTokenProgram: l.tokenProgram, eventAuthority, program: PROGRAM_ID })
                .instruction(),
            );
            const { signature } = await sendKeeperTx(connection, keeper, ixs, { lookupTables, computeUnits: 1_000_000 });
            await ingestTx(signature);
            const h = report.harvested.find((x) => x.vault === v.address) ?? (report.harvested[report.harvested.push({ vault: v.address, input: "0", signature, swaps: [] }) - 1]);
            h.swaps.push({ leg, out: q.quote.toString(), signature });
            // the keeper now holds the WSOL it swapped with; unwrap is left to the operator (it is real SOL either way)
            void createSyncNativeInstruction;
          } catch (e) {
            report.skipped.push({ vault: v.address, step: "swap", reason: `leg ${leg}: ${short(e)}` });
          }
        }
      }

      // 4. epoch close
      if (!isOperator) continue;
      try {
        if (remaining() < 40_000) break;
        const res = await maybePublishEpoch(v, v.launchMint!, now);
        if (res.kind === "published") report.published.push({ vault: v.address, epochId: res.epochId, holders: res.holders, signature: res.signature });
        else if (res.kind === "skipped") report.skipped.push({ vault: v.address, step: "epoch", reason: res.reason });
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "epoch", reason: short(e) });
      }

      // 5. expire stale epochs
      try {
        const stale = await c.epochs.find({ cluster, vault: v.address, status: "published", claimableAt: { $ne: null, $lt: now - Number(cfg.claimWindow) } }).toArray();
        for (const e of stale) {
          if (remaining() < 20_000) break;
          const ix = await program.methods.expireEpoch().accountsStrict({ config, vault: vaultKey, epoch: epochPda(vaultKey, e.epochId), eventAuthority, program: PROGRAM_ID }).instruction();
          const { signature } = await sendKeeperTx(connection, keeper, [ix], { computeUnits: 100_000 });
          await ingestTx(signature);
          report.expired.push({ vault: v.address, epochId: e.epochId, signature });
        }
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "expire", reason: short(e) });
      }

      // 6. keeper-paid delivery (creator opt-in)
      const policy = autoClaimPolicy();
      if (s.autoClaim && policy.enabled) {
        try {
          await autoDeliver(v, vaultKey, now, policy);
        } catch (e) {
          report.skipped.push({ vault: v.address, step: "deliver", reason: short(e) });
        }
      }
    }
    return report;
  } finally {
    await releaseLease(owner).catch(() => {});
    report.ms = Date.now() - started;
  }

  // ---------------------------------------------------------------------------------------------------------

  async function tokenPrices(mints: string[]): Promise<Map<string, { priceUsd: number; decimals: number }>> {
    const docs = await c.tokens.find({ _id: { $in: mints.map((m) => `${cluster}:${m}`) } }, { projection: { mint: 1, priceUsd: 1, decimals: 1 } }).toArray();
    const out = new Map<string, { priceUsd: number; decimals: number }>();
    for (const d of docs) {
      const p = d.priceUsd ? Number(d.priceUsd.toString()) : 0;
      if (p > 0) out.set(d.mint, { priceUsd: p, decimals: d.decimals });
    }
    return out;
  }

  /** Claims every deliverable payout for holders of `v`, one transaction per holder covering up to 4 open epochs. */
  async function autoDeliver(v: VaultDoc, vaultKey: PublicKey, now: number, policy: ReturnType<typeof autoClaimPolicy>) {
    const epochs = await c.epochs.find({ cluster, vault: v.address, status: "published", claimableAt: { $ne: null, $lte: now - policy.delaySeconds } }).toArray();
    if (epochs.length === 0) return;
    const retryBefore = new Date((now - policy.retrySeconds) * 1000);
    const leaves = await c.epochLeaves
      .find({
        cluster, vault: v.address, epochId: { $in: epochs.map((e) => e.epochId) }, claimed: false,
        $or: [{ pushAttemptAt: null }, { pushAttemptAt: { $exists: false } }, { pushAttemptAt: { $lte: retryBefore } }],
      })
      .toArray();
    if (leaves.length === 0) return;
    const byAccount = new Map<string, EpochLeafDoc[]>();
    for (const l of leaves) byAccount.set(l.account, [...(byAccount.get(l.account) ?? []), l]);
    const epochById = new Map(epochs.map((e) => [e.epochId, e]));
    const prices = await tokenPrices([...new Set(epochs.flatMap((e) => e.mints))]);
    const basket = v.basket;
    let sent = 0;
    for (const [holder, mine] of byAccount) {
      if (sent >= policy.maxPerRun || remaining() < 20_000) break;
      const account = new PublicKey(holder);
      let usd = 0;
      for (const l of mine) {
        const e = epochById.get(l.epochId)!;
        e.mints.forEach((m, i) => {
          const p = prices.get(m);
          if (p) usd += Number(formatUnits(BigInt(l.amounts[i]), p.decimals)) * p.priceUsd;
        });
      }
      if (policy.minUsd > 0 && usd < policy.minUsd) continue;
      // skip epochs the chain already shows as claimed (indexer lag)
      const statusKeys = mine.map((l) => claimPda(epochPda(vaultKey, l.epochId), account));
      const infos = await connection.getMultipleAccountsInfo(statusKeys);
      const todo = mine.filter((_, i) => !infos[i]).slice(0, MAX_CLAIMS_PER_TX);
      if (todo.length === 0) continue;
      const leafIds = todo.map((l) => l._id);
      // stamp the attempt before sending: if this process dies mid-way the leaf waits `retrySeconds`, and the
      // claim-status check above makes a double delivery impossible anyway
      await c.epochLeaves.updateMany({ _id: { $in: leafIds } }, { $set: { pushAttemptAt: new Date(), pushError: null } });
      try {
        const ixs: TransactionInstruction[] = [];
        const created = new Set<string>();
        for (const l of todo) {
          const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
          l.amounts.forEach((a, i) => {
            if (BigInt(a) === 0n) return;
            const leg = basket[i];
            const mint = new PublicKey(leg.mint);
            const tokenProgram = new PublicKey(leg.tokenProgram || TOKEN_PROGRAM_ID.toBase58());
            const holderAta = ata(account, mint, tokenProgram);
            if (!created.has(holderAta.toBase58())) {
              ixs.push(createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, holderAta, account, mint, tokenProgram));
              created.add(holderAta.toBase58());
            }
            remainingAccounts.push(
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: ata(vaultKey, mint, tokenProgram), isSigner: false, isWritable: true },
              { pubkey: holderAta, isSigner: false, isWritable: true },
              { pubkey: tokenProgram, isSigner: false, isWritable: false },
            );
          });
          const epoch = epochPda(vaultKey, l.epochId);
          ixs.push(
            await program.methods
              .claim({ epochId: bn(l.epochId), amounts: l.amounts.map(bn), proof: l.proof.map((p) => [...unhex(p)]) })
              .accountsStrict({ payer: keeper.publicKey, config, vault: vaultKey, epoch, account, claimStatus: claimPda(epoch, account), systemProgram: SystemProgram.programId, eventAuthority, program: PROGRAM_ID })
              .remainingAccounts(remainingAccounts)
              .instruction(),
          );
        }
        const { signature } = await sendKeeperTx(connection, keeper, ixs, { computeUnits: 600_000 });
        await c.epochLeaves.updateMany({ _id: { $in: leafIds } }, { $set: { pushSignature: signature } });
        await ingestTx(signature);
        report.delivered.push({ vault: v.address, account: holder, epochs: todo.map((l) => l.epochId), signature });
        sent++;
      } catch (e) {
        const msg = short(e);
        await c.epochLeaves.updateMany({ _id: { $in: leafIds } }, { $set: { pushError: msg } });
        report.skipped.push({ vault: v.address, step: "deliver", reason: `${holder}: ${msg}` });
      }
    }
  }

  async function maybePublishEpoch(
    v: VaultDoc,
    launchMint: string,
    now: number,
  ): Promise<{ kind: "none" } | { kind: "skipped"; reason: string } | { kind: "published"; epochId: number; holders: number; signature: string }> {
    const vaultKey = new PublicKey(v.address);
    const s = await program.account.vault.fetch(vaultKey);
    const periodStart = Number(s.lastPeriodEnd);
    const epochLength = Number(s.epochLength);
    if (now < periodStart + epochLength) return { kind: "none" };
    if (s.swapInFlight) return { kind: "skipped", reason: "swap in flight" };
    const epochId = Number(s.epochCount) + 1;
    const b = await buildEpoch({
      v, launchMint, now, periodStart, epochLength, epochId, address: epochPda(vaultKey, epochId).toBase58(),
      unallocated: s.legs.map((l) => big(l.unallocated)), mints: s.legs.map((l) => l.mint.toBase58()),
    });
    if (b.kind !== "built") return b;
    await persistEpoch(b, launchMint);
    const ix = await program.methods
      .publishEpoch({ root: [...unhex(b.root)], amounts: b.amounts.map(bn), periodStart: bn(periodStart), periodEnd: bn(b.periodEnd), holderCount: b.holders })
      .accountsStrict({ operator: keeper.publicKey, config, vault: vaultKey, epoch: epochPda(vaultKey, epochId), systemProgram: SystemProgram.programId, eventAuthority, program: PROGRAM_ID })
      .instruction();
    const { signature } = await sendKeeperTx(connection, keeper, [ix], { computeUnits: 200_000 });
    await ingestTx(signature);
    await refreshVaults([v.address]);
    return { kind: "published", epochId, holders: b.holders, signature };
  }
}

export { envValue };
