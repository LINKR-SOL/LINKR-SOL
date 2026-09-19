import type { Filter } from "mongodb";
import { PublicKey } from "@solana/web3.js";
import { activeCluster, isCustodial, PROGRAM_ID, VAULT_PROGRAM_KEY } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { configPda, readonlyProgram } from "../solana/program";
import { collections } from "../db/collections";
import type { EpochDoc, EpochLeafDoc, TokenDoc, VaultDoc } from "../db/types";
import type { ClaimsJson, EpochJson, EpochLeafJson, HarvestJson, HarvestQuoteJson, TokenJson, VaultConfigJson, VaultJson } from "../api-types";
import { quoteSizedHarvest } from "../dividends/quote";
import { autoClaimPolicy } from "../indexer/dividendKeeper";
import { launchToJson } from "./launches";
import { getPricesFor } from "../xstocks/prices";
import { ensureTokens, tokenJson, tokenMap } from "./tokens";
import { projectionsFor } from "./projection";
import { isHidden } from "../hidden";

const cluster = activeCluster;
const programId = VAULT_PROGRAM_KEY;

async function stockPrices(mints: string[] = []): Promise<Map<string, number>> {
  try {
    return await getPricesFor(mints);
  } catch {
    return new Map();
  }
}

const basketMints = (docs: VaultDoc[]) => [...new Set(docs.flatMap((v) => v.basket.map((b) => b.mint)))];
const vaultMints = (v: VaultDoc) => [...v.basket.map((b) => b.mint), v.quoteMint];

function priced(map: Map<string, TokenDoc>, px: Map<string, number>, mint: string): TokenJson {
  const base = tokenJson(map, mint);
  const live = px.get(mint);
  return live === undefined ? base : { ...base, priceUsd: String(live), priceSource: "jupiter" };
}

export async function vaultToJson(v: VaultDoc, tokens?: Map<string, TokenDoc>, prices?: Map<string, number>): Promise<VaultJson> {
  const c = await collections();
  const map = tokens ?? (await tokenMap(vaultMints(v)));
  const px = prices ?? (await stockPrices(vaultMints(v)));
  const launch = v.launchMint ? await c.launches.findOne({ _id: `${cluster}:${v.launchMint}` }) : null;
  // Between the launch landing and the keeper binding it there is a window of a minute or two where the vault
  // is still "pending" but a coin already names it as creator. Surface that, so nobody launches twice.
  const pendingLaunch = v.status === "pending" ? await c.launches.findOne({ cluster, creator: v.address }) : null;
  const idle = BigInt(v.idleLamports || "0") + BigInt(v.idleQuote || "0");
  return {
    address: v.address,
    creator: v.creator,
    salt: v.salt,
    expectedMint: v.expectedMint,
    status: v.status,
    basket: v.basket.map((b, i) => ({
      ...priced(map, px, b.mint),
      weightBps: b.weightBps,
      unallocated: v.unallocated[i] ?? "0",
      allocated: v.allocated[i] ?? "0",
      pendingSwap: v.pendingSwap?.[i] ?? "0",
      harvestedTotal: v.harvestedTotals[i] ?? "0",
    })),
    epochLength: v.epochLength,
    launchMint: v.launchMint ?? null,
    quote: priced(map, px, v.quoteMint),
    boundAt: v.boundAt ? v.boundAt.toISOString() : null,
    lastPeriodEnd: v.lastPeriodEnd,
    // the next period boundary after now: a close with nothing to pay publishes no epoch and leaves
    // lastPeriodEnd where it was, so start + length can already be in the past
    nextEpochAt: v.lastPeriodEnd === null ? null : v.lastPeriodEnd + (Math.max(0, Math.floor((Date.now() / 1000 - v.lastPeriodEnd) / v.epochLength)) + 1) * v.epochLength,
    epochCount: v.epochCount,
    creatorVaultBalance: v.creatorVaultBalance ?? "0",
    idleQuote: idle.toString(),
    inputTotal: v.inputTotal,
    protocolCutTotal: v.protocolCutTotal,
    harvestCount: v.harvestCount,
    lastHarvestAt: v.lastHarvestAt ? v.lastHarvestAt.toISOString() : null,
    // custodial vaults always airdrop; program-mode vaults follow their on-chain switch
    autoClaim: v.programId === "custodial" || (v.autoClaim ?? false),
    createdAt: v.createdAt.toISOString(),
    createdAtSignature: v.createdAtSignature,
    launch: launch ? launchToJson(launch) : null,
    pendingLaunch: pendingLaunch ? launchToJson(pendingLaunch) : null,
  };
}

export async function epochToJson(e: EpochDoc, tokens?: Map<string, TokenDoc>): Promise<EpochJson> {
  const map = tokens ?? (await tokenMap(e.mints));
  return {
    vault: e.vault,
    epochId: e.epochId,
    address: e.address ?? null,
    status: e.status,
    root: e.root,
    tokens: e.mints.map((m) => tokenJson(map, m)),
    amounts: e.amounts,
    claimedTotals: e.claimedTotals,
    periodStart: e.periodStart,
    periodEnd: e.periodEnd,
    claimableAt: e.claimableAt,
    holderCount: e.holderCount,
    dropped: e.dropped,
    residue: e.residue,
    sumAcc: e.sumAcc,
    algorithmVersion: e.algorithmVersion,
    excluded: e.excluded,
    snapshotFromSlot: e.snapshotFromSlot,
    snapshotToSlot: e.snapshotToSlot,
    publishedSignature: e.publishedSignature,
    closedSignature: e.closedSignature,
    createdAt: e.createdAt.toISOString(),
  };
}

export function leafToJson(l: EpochLeafDoc, sumAcc: string): EpochLeafJson {
  const sum = BigInt(sumAcc || "0");
  return {
    account: l.account,
    amounts: l.amounts,
    proof: l.proof,
    acc: l.acc,
    sharePpm: sum > 0n ? Number((BigInt(l.acc) * 1_000_000n) / sum) : 0,
    claimed: l.claimed,
    claimedSignature: l.claimedSignature,
  };
}

export async function listVaults(opts: { creator?: string; mint?: string; limit?: number }): Promise<VaultJson[]> {
  const c = await collections();
  const filter: Filter<VaultDoc> = { cluster, programId };
  if (opts.creator) filter.creator = opts.creator;
  if (opts.mint) filter.$or = [{ launchMint: opts.mint }, { expectedMint: opts.mint }];
  const docs = (await c.vaults.find(filter).sort({ createdAtSlot: -1 }).limit(Math.min(opts.limit ?? 50, 200)).toArray()).filter(
    (v) => !isHidden(v.address, v.launchMint, v.expectedMint),
  );
  const mints = [...new Set(docs.flatMap(vaultMints))];
  const map = await ensureTokens(mints);
  const px = await stockPrices(mints);
  return Promise.all(docs.map((v) => vaultToJson(v, map, px)));
}

export async function getVault(address: string): Promise<VaultJson | null> {
  const c = await collections();
  const doc = await c.vaults.findOne({ _id: `${cluster}:${address}` });
  if (!doc || doc.programId !== programId || isHidden(doc.address, doc.launchMint, doc.expectedMint)) return null;
  await ensureTokens(vaultMints(doc));
  return vaultToJson(doc);
}

export async function listEpochs(vault: string): Promise<EpochJson[]> {
  if (isHidden(vault)) return [];
  const c = await collections();
  const docs = await c.epochs.find({ cluster, vault }).sort({ epochId: -1 }).toArray();
  const map = await tokenMap([...new Set(docs.flatMap((e) => e.mints))]);
  return Promise.all(docs.map((e) => epochToJson(e, map)));
}

/**
 * Every fee conversion this vault has made, newest first: the intake (SOL in, per-leg reservations) joined with
 * the swaps that followed it. Epochs only appear once a period closes, so for the first day of a vault's life
 * these are the only evidence that anything is happening — and they stay the audit trail behind every payout.
 */
export async function listHarvests(vault: string, limit = 50): Promise<HarvestJson[]> {
  const c = await collections();
  const v = await c.vaults.findOne({ _id: `${cluster}:${vault}` });
  if (!v || isHidden(v.address, v.launchMint)) return [];
  const [harvests, swaps] = await Promise.all([
    c.harvests.find({ cluster, vault }).sort({ slot: -1 }).limit(Math.min(limit, 200)).toArray(),
    c.swaps.find({ cluster, vault }).sort({ slot: 1 }).toArray(),
  ]);
  if (harvests.length === 0) return [];
  const mints = vaultMints(v);
  const map = await tokenMap(mints);
  const px = await stockPrices(mints);
  const ordered = [...harvests].sort((a, b) => a.slot - b.slot);
  return harvests.map((h) => {
    const next = ordered[ordered.indexOf(h) + 1];
    const mine = swaps.filter((s) => s.slot >= h.slot && (!next || s.slot < next.slot));
    return {
      signature: h.signature,
      timestamp: h.timestamp.toISOString(),
      caller: h.caller,
      quote: priced(map, px, v.quoteMint),
      input: h.input,
      protocolCut: h.protocolCut,
      legs: v.basket.map((b, i) => {
        const s = mine.find((x) => x.leg === i);
        return {
          token: priced(map, px, b.mint),
          amountIn: h.legInputs[i] ?? "0",
          amountOut: b.mint === v.quoteMint ? (h.legInputs[i] ?? "0") : (s?.amountOut ?? null),
          swapSignature: s?.signature ?? null,
        };
      }),
    };
  });
}

/** Everything `account` can claim across all vaults, its claim history, and what is still accruing. */
export async function claimsFor(account: string): Promise<ClaimsJson> {
  const c = await collections();
  const leaves = await c.epochLeaves.find({ cluster, account, claimed: false }).toArray();
  const vaultAddrs = [...new Set(leaves.map((l) => l.vault))];
  const claimed = await c.claims.find({ cluster, account }).sort({ timestamp: -1 }).limit(200).toArray();
  const vaultDocs = (await c.vaults.find({ cluster, address: { $in: vaultAddrs } }).toArray()).filter((v) => !isHidden(v.address, v.launchMint));
  const allMints = [...new Set([...vaultDocs.flatMap(vaultMints), ...claimed.flatMap((cl) => cl.mints)])];
  const map = await tokenMap(allMints);
  const px = await stockPrices(allMints);

  const out: ClaimsJson = { account, vaults: [], projections: [], history: [] };
  for (const v of vaultDocs) {
    const epochs = await c.epochs.find({ cluster, vault: v.address, status: { $in: ["published", "computed"] } }).sort({ epochId: 1 }).toArray();
    const mine = leaves.filter((l) => l.vault === v.address);
    const claimable = epochs
      .map((e) => {
        const leaf = mine.find((l) => l.epochId === e.epochId);
        if (!leaf) return null;
        return {
          epochId: e.epochId,
          address: e.address ?? null,
          status: e.status as "published" | "computed",
          claimableAt: e.claimableAt,
          periodStart: e.periodStart,
          periodEnd: e.periodEnd,
          createdAt: e.createdAt.toISOString(),
          amounts: leaf.amounts,
          proof: leaf.proof,
          tokens: e.mints.map((m) => priced(map, px, m)),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (claimable.length) out.vaults.push({ vault: await vaultToJson(v, map, px), epochs: claimable });
  }
  // What the next payout is shaping up to be. Best-effort: a slow or failing projection must never keep a holder
  // from seeing what is already claimable.
  try {
    const boundDocs = (await c.vaults.find({ cluster, programId, launchMint: { $ne: null } }).toArray()).filter((v) => !isHidden(v.address, v.launchMint));
    const projMints = [...new Set(boundDocs.flatMap(vaultMints))];
    const projMap = await tokenMap(projMints);
    const projPx = await stockPrices(projMints);
    out.projections = await projectionsFor(account, boundDocs, (v) => vaultToJson(v, projMap, projPx));
  } catch (e) {
    console.error("[claims] projection", e);
  }
  out.history = claimed.filter((cl) => !isHidden(cl.vault)).map((cl) => ({
    vault: cl.vault,
    epochId: cl.epochId,
    tokens: cl.mints.map((m) => priced(map, px, m)),
    amounts: cl.amounts,
    signature: cl.signature,
    timestamp: cl.timestamp.toISOString(),
  }));
  return out;
}

/** Live quote for a manual harvest (the creator's "Harvest now" button). */
export async function harvestQuote(vaultAddress: string, slippageBps = 100): Promise<HarvestQuoteJson> {
  const c = await collections();
  const v = await c.vaults.findOne({ _id: `${cluster}:${vaultAddress}` });
  if (!v) throw new Error("vault not found");
  if (!v.launchMint) throw new Error("vault is not bound to a launch yet");
  const protocolShareBps = isCustodial
    ? (await import("../custody/config")).custodialConfig().protocolShareBps
    : (await readonlyProgram(serverConnection()).account.config.fetch(configPda())).protocolShareBps;
  const total = BigInt(v.creatorVaultBalance || "0") + BigInt(v.idleLamports || "0") + BigInt(v.idleQuote || "0");
  if (total === 0n) throw new Error("nothing to harvest");
  const { quote: q } = await quoteSizedHarvest({
    quoteMint: v.quoteMint, gross: total, basket: v.basket, protocolShareBps, slippageBps, floor: 1_000n,
  });
  const map = await tokenMap(vaultMints(v));
  return {
    quote: tokenJson(map, v.quoteMint),
    available: total.toString(),
    gross: q.gross.toString(),
    protocolCut: q.protocolCut.toString(),
    net: q.net.toString(),
    slippageBps,
    legs: q.legs.map((l) => ({ token: tokenJson(map, l.mint), amountIn: l.amountIn.toString(), quote: l.quote.toString(), minOut: l.minOut.toString(), swap: l.swap })),
    minOuts: q.minOuts.map(String),
  };
}

/** Program configuration + the allowlisted basket mints (read live from chain). */
export async function vaultConfig(): Promise<VaultConfigJson> {
  const connection = serverConnection();
  if (isCustodial) {
    const { custodialConfig } = await import("../custody/config");
    const cfg = custodialConfig();
    const mints = cfg.allowlist;
    const map = await ensureTokens(mints, { kind: undefined });
    const px = await stockPrices(mints);
    return {
      programId,
      cluster,
      admin: cfg.operator,
      operator: cfg.operator,
      protocolShareBps: cfg.protocolShareBps,
      protocolRecipient: cfg.protocolRecipient,
      disputeWindow: cfg.disputeWindow,
      claimWindow: cfg.claimWindow,
      minEpochLength: cfg.minEpochLength,
      paused: cfg.paused,
      basketTokens: mints.map((m) => priced(map, px, m)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
      autoClaim: autoClaimPolicy(),
    };
  }
  const program = readonlyProgram(connection);
  const cfg = await program.account.config.fetchNullable(configPda());
  if (!cfg) throw new Error("causa_vault is not initialised on this cluster");
  const allowed = await program.account.allowedBasketMint.all();
  const mints = allowed.map((a) => (a.account.mint as PublicKey).toBase58());
  const map = await ensureTokens(mints, { kind: undefined });
  const px = await stockPrices(mints);
  return {
    programId,
    cluster,
    admin: cfg.admin.toBase58(),
    operator: cfg.operator.toBase58(),
    protocolShareBps: cfg.protocolShareBps,
    protocolRecipient: cfg.protocolRecipient.toBase58(),
    disputeWindow: cfg.disputeWindow,
    claimWindow: cfg.claimWindow,
    minEpochLength: cfg.minEpochLength,
    paused: cfg.paused,
    basketTokens: mints.map((m) => priced(map, px, m)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    autoClaim: autoClaimPolicy(),
  };
}
