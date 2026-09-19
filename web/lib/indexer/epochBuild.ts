import { activeCluster } from "../solana/cluster";
import { collections } from "../db/collections";
import type { EpochDoc, EpochLeafDoc, HolderSnapshotDoc, VaultDoc } from "../db/types";
import { allocate, computeTwab } from "../dividends/twab";
import { excludedOwners } from "../dividends/excluded";
import { buildTree } from "../dividends/merkle";
import { epochDocId, leafId } from "./ingest";

/**
 * The part of "publish an epoch" that is the same whether vaults live in the program or with the custodial
 * keeper: decide whether a period has closed and is fully indexed, weigh every holder over it, split the pot,
 * build the Merkle tree and shape the documents. The caller then persists them and does its own publishing.
 */

const cluster = activeCluster;
export const ALGORITHM_VERSION = 2;

/** Flooring residue stays unallocated after every epoch; legs below this many raw units roll forward. */
export const dustUnits = () => {
  const v = Number(process.env.DIVIDEND_DUST_UNITS);
  return BigInt(Number.isFinite(v) && process.env.DIVIDEND_DUST_UNITS ? Math.max(0, Math.floor(v)) : 1_000);
};

export interface EpochBuildInput {
  v: VaultDoc;
  launchMint: string;
  now: number;
  periodStart: number;
  epochLength: number;
  epochId: number;
  /** on-chain epoch address in program mode; null for custodial vaults */
  address: string | null;
  /** per-leg pot available for this epoch, raw units, aligned with the basket */
  unallocated: bigint[];
  mints: string[];
}

export type EpochBuildResult =
  | { kind: "none" }
  | { kind: "skipped"; reason: string }
  | { kind: "built"; doc: EpochDoc; leaves: EpochLeafDoc[]; snaps: HolderSnapshotDoc[]; periodEnd: number; amounts: bigint[]; holders: number; root: string };

export async function buildEpoch(input: EpochBuildInput): Promise<EpochBuildResult> {
  const { v, launchMint, now, periodStart, epochLength, epochId } = input;
  if (now < periodStart + epochLength) return { kind: "none" };
  const c = await collections();
  const stream = await c.transferStreams.findOne({ _id: `${cluster}:${launchMint}` });
  if (!stream || stream.cursorTimestamp === null) return { kind: "skipped", reason: "balance stream not synced yet" };
  if (!stream.backfilled) return { kind: "skipped", reason: "balance stream still backfilling" };
  // one epoch covering every full period that has elapsed and is fully indexed
  const k = Math.floor((Math.min(now, stream.cursorTimestamp) - periodStart) / epochLength);
  if (k < 1) return { kind: "skipped", reason: "waiting for the balance stream to pass the period end" };
  const periodEnd = periodStart + k * epochLength;
  const DUST = dustUnits();
  const totals = input.unallocated.map((u) => (u >= DUST ? u : 0n));
  if (totals.every((t) => t === 0n)) return { kind: "none" };

  // starting balances: snapshot at periodStart if we took one, else full replay from launch
  const snapshot = await c.holderSnapshots.find({ cluster, mint: launchMint, periodEnd: periodStart }).toArray();
  const fromSlot = snapshot.length ? Math.max(...snapshot.map((h) => h.asOfSlot)) : null;
  const changes = await c.balanceChanges
    .find(fromSlot === null ? { cluster, mint: launchMint } : { cluster, mint: launchMint, slot: { $gt: fromSlot } })
    .sort({ slot: 1, index: 1 })
    .toArray();
  const excluded = await excludedOwners(v.address, launchMint);
  const twab = computeTwab({
    changes: changes.map((t) => ({ owner: t.owner, delta: BigInt(t.delta), timestamp: t.timestamp, slot: t.slot, index: t.index })),
    startBalances: snapshot.map((h) => [h.owner, BigInt(h.balance)] as [string, bigint]),
    start: periodStart,
    end: periodEnd,
    excluded,
  });
  const alloc = allocate(totals, twab.acc, twab.sumAcc);
  if (alloc.leaves.length === 0) return { kind: "skipped", reason: "no eligible holders in the period" };
  const tree = buildTree(BigInt(epochId), alloc.leaves);
  const asOfSlot = changes.filter((t) => t.timestamp < periodEnd).reduce((m, t) => Math.max(m, t.slot), fromSlot ?? stream.startSlot ?? 0);
  const nowDate = new Date();

  const doc: EpochDoc = {
    _id: epochDocId(v.address, epochId),
    cluster,
    vault: v.address,
    epochId,
    address: input.address,
    status: "computed",
    root: tree.root,
    mints: input.mints,
    amounts: alloc.amounts.map(String),
    periodStart,
    periodEnd,
    claimableAt: null,
    holderCount: alloc.leaves.length,
    dropped: alloc.dropped,
    residue: alloc.residue.map(String),
    sumAcc: twab.sumAcc.toString(),
    algorithmVersion: ALGORITHM_VERSION,
    excluded: [...excluded],
    snapshotFromSlot: fromSlot,
    snapshotToSlot: asOfSlot,
    claimedTotals: input.mints.map(() => "0"),
    publishedSignature: null,
    publishedAtSlot: null,
    closedSignature: null,
    tree: tree.dump,
    createdAt: nowDate,
    updatedAt: nowDate,
  };
  const leaves: EpochLeafDoc[] = alloc.leaves.map((l) => ({
    _id: leafId(v.address, epochId, l.account),
    cluster,
    vault: v.address,
    epochId,
    account: l.account,
    amounts: l.amounts.map(String),
    proof: tree.proofs.get(l.account) ?? [],
    acc: l.acc.toString(),
    claimed: false,
    claimedSignature: null,
    claimedAt: null,
  }));
  const snaps: HolderSnapshotDoc[] = [...twab.balances.entries()].map(([owner, balance]) => ({
    _id: `${cluster}:${launchMint}:${periodEnd}:${owner}`,
    cluster,
    mint: launchMint,
    periodEnd,
    owner,
    balance: balance.toString(),
    asOfSlot,
  }));
  return { kind: "built", doc, leaves, snaps, periodEnd, amounts: alloc.amounts, holders: alloc.leaves.length, root: tree.root };
}

/** Writes the epoch, its leaves and the end-of-period holder snapshot (replacing any earlier attempt). */
export async function persistEpoch(b: Extract<EpochBuildResult, { kind: "built" }>, launchMint: string): Promise<void> {
  const c = await collections();
  await c.epochs.updateOne({ _id: b.doc._id }, { $set: b.doc }, { upsert: true });
  await c.epochLeaves.deleteMany({ cluster, vault: b.doc.vault, epochId: b.doc.epochId });
  for (let i = 0; i < b.leaves.length; i += 500) await c.epochLeaves.insertMany(b.leaves.slice(i, i + 500), { ordered: false });
  await c.holderSnapshots.deleteMany({ cluster, mint: launchMint, periodEnd: b.periodEnd });
  for (let i = 0; i < b.snaps.length; i += 500) await c.holderSnapshots.insertMany(b.snaps.slice(i, i + 500), { ordered: false });
}
