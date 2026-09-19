import { activeCluster, VAULT_PROGRAM_KEY } from "../solana/cluster";
import { collections } from "../db/collections";
import type { ClaimDoc, HarvestDoc, SwapDoc, TransferStreamDoc, VaultBasketDoc, VaultDoc } from "../db/types";
import { epochDocId, leafId, streamId, vaultId } from "../indexer/ingest";
import { vaultAddress } from "./keys";

/**
 * The custodial keeper's book-keeping. In program mode these numbers live in the Vault account and the indexer
 * copies them from events; here the keeper is the only writer and Mongo is the ledger. Every function keeps the
 * same invariants the program enforces: pot = Σ unallocated + allocated (+ pending swaps in SOL), an epoch moves
 * unallocated → allocated, a delivery moves allocated → the holder, cancel/expire moves the remainder back.
 */

const cluster = activeCluster;

export const custodialVaultId = vaultId;

export async function loadVault(address: string): Promise<VaultDoc> {
  const c = await collections();
  const v = await c.vaults.findOne({ _id: vaultId(address) });
  if (!v) throw new Error("vault not found");
  return v;
}

const bigs = (xs: string[] | undefined, n: number) => Array.from({ length: n }, (_, i) => BigInt(xs?.[i] ?? "0"));
const strs = (xs: bigint[]) => xs.map(String);

export interface CreateCustodialVaultInput {
  creator: string;
  salt: string;
  basket: VaultBasketDoc[];
  epochLength: number;
  expectedMint: string;
  /** what the coin trades against, and so what creator fees arrive in */
  quote: { mint: string; tokenProgram: string; decimals: number };
}

/** Registers a vault: no transaction, the address is derived from the keeper secret + (creator, salt). */
export async function createCustodialVault(input: CreateCustodialVaultInput): Promise<VaultDoc> {
  const c = await collections();
  const address = vaultAddress(input.creator, input.salt);
  const existing = await c.vaults.findOne({ _id: vaultId(address) });
  if (existing) return existing;
  const now = new Date();
  const zeros = input.basket.map(() => "0");
  const doc: VaultDoc = {
    _id: vaultId(address),
    cluster,
    address,
    programId: VAULT_PROGRAM_KEY,
    creator: input.creator,
    salt: input.salt,
    expectedMint: input.expectedMint,
    basket: input.basket,
    epochLength: input.epochLength,
    launchMint: null,
    quoteMint: input.quote.mint,
    quoteTokenProgram: input.quote.tokenProgram,
    quoteDecimals: input.quote.decimals,
    boundAt: null,
    status: "pending",
    lastPeriodEnd: null,
    epochCount: 0,
    unallocated: zeros,
    allocated: zeros,
    pendingSwap: zeros,
    harvestedTotals: zeros,
    creatorVaultBalance: "0",
    idleLamports: "0",
    idleQuote: "0",
    inputTotal: "0",
    protocolCutTotal: "0",
    harvestCount: 0,
    lastHarvestAt: null,
    autoClaim: true,
    createdAt: now,
    createdAtSlot: 0,
    createdAtSignature: "",
    updatedAt: now,
  };
  await c.vaults.insertOne(doc);
  return doc;
}

/** The coin launched with this vault as creator: start the clock and the coin's balance stream. */
export async function bindCustodialVault(address: string, mint: string, boundAt: number): Promise<void> {
  const c = await collections();
  await c.vaults.updateOne(
    { _id: vaultId(address), status: "pending" },
    { $set: { launchMint: mint, status: "active", boundAt: new Date(boundAt * 1000), lastPeriodEnd: boundAt, updatedAt: new Date() } },
  );
  const stream: TransferStreamDoc = {
    _id: streamId(mint),
    cluster,
    mint,
    vault: address,
    startSignature: null,
    startSlot: null,
    cursorSignature: null,
    cursorSlot: 0,
    cursorTimestamp: null,
    backfilled: false,
    backfillSignature: null,
    lastRunAt: null,
    lastError: null,
  };
  await c.transferStreams.updateOne({ _id: stream._id }, { $setOnInsert: stream }, { upsert: true });
}

export async function recordHarvest(
  address: string,
  p: { caller: string; input: bigint; protocolCut: bigint; legInputs: bigint[]; signature: string; slot: number },
): Promise<void> {
  const c = await collections();
  const v = await loadVault(address);
  const n = v.basket.length;
  const pendingSwap = bigs(v.pendingSwap, n);
  const unallocated = bigs(v.unallocated, n);
  const harvestedTotals = bigs(v.harvestedTotals, n);
  v.basket.forEach((leg, i) => {
    if (leg.mint === v.quoteMint) {
      unallocated[i] += p.legInputs[i];
      harvestedTotals[i] += p.legInputs[i];
    } else {
      pendingSwap[i] += p.legInputs[i];
    }
  });
  const now = new Date();
  await c.vaults.updateOne(
    { _id: vaultId(address) },
    {
      $set: {
        pendingSwap: strs(pendingSwap),
        unallocated: strs(unallocated),
        harvestedTotals: strs(harvestedTotals),
        inputTotal: (BigInt(v.inputTotal || "0") + p.input).toString(),
        protocolCutTotal: (BigInt(v.protocolCutTotal || "0") + p.protocolCut).toString(),
        harvestCount: (v.harvestCount ?? 0) + 1,
        lastHarvestAt: now,
        updatedAt: now,
      },
    },
  );
  const doc: HarvestDoc = {
    _id: `${p.signature}:0`,
    cluster,
    vault: address,
    caller: p.caller,
    input: p.input.toString(),
    protocolCut: p.protocolCut.toString(),
    legInputs: strs(p.legInputs),
    signature: p.signature,
    slot: p.slot,
    timestamp: now,
  };
  await c.harvests.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
}

export async function recordSwap(address: string, p: { leg: number; amountIn: bigint; amountOut: bigint; signature: string; slot: number }): Promise<void> {
  const c = await collections();
  const v = await loadVault(address);
  const n = v.basket.length;
  const pendingSwap = bigs(v.pendingSwap, n);
  const unallocated = bigs(v.unallocated, n);
  const harvestedTotals = bigs(v.harvestedTotals, n);
  pendingSwap[p.leg] = pendingSwap[p.leg] > p.amountIn ? pendingSwap[p.leg] - p.amountIn : 0n;
  unallocated[p.leg] += p.amountOut;
  harvestedTotals[p.leg] += p.amountOut;
  const now = new Date();
  await c.vaults.updateOne(
    { _id: vaultId(address) },
    { $set: { pendingSwap: strs(pendingSwap), unallocated: strs(unallocated), harvestedTotals: strs(harvestedTotals), updatedAt: now } },
  );
  const doc: SwapDoc = {
    _id: `${p.signature}:0`,
    cluster,
    vault: address,
    leg: p.leg,
    mint: v.basket[p.leg].mint,
    amountIn: p.amountIn.toString(),
    amountOut: p.amountOut.toString(),
    signature: p.signature,
    slot: p.slot,
    timestamp: now,
  };
  await c.swaps.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
}

/** Moves the epoch's amounts from the pot into the open payout and starts the review window. */
export async function publishCustodialEpoch(
  address: string,
  p: { epochId: number; amounts: bigint[]; periodEnd: number; claimableAt: number; signature: string | null; slot: number | null },
): Promise<void> {
  const c = await collections();
  const v = await loadVault(address);
  const n = v.basket.length;
  const unallocated = bigs(v.unallocated, n);
  const allocated = bigs(v.allocated, n);
  p.amounts.forEach((a, i) => {
    if (a > unallocated[i]) throw new Error(`epoch ${p.epochId} leg ${i} exceeds the pot`);
    unallocated[i] -= a;
    allocated[i] += a;
  });
  const now = new Date();
  await c.vaults.updateOne(
    { _id: vaultId(address) },
    { $set: { unallocated: strs(unallocated), allocated: strs(allocated), epochCount: p.epochId, lastPeriodEnd: p.periodEnd, updatedAt: now } },
  );
  await c.epochs.updateOne(
    { _id: epochDocId(address, p.epochId) },
    { $set: { status: "published", claimableAt: p.claimableAt, publishedSignature: p.signature, publishedAtSlot: p.slot, updatedAt: now } },
  );
}

/**
 * A holder received their share, or the `legs` of it one transaction carried (a basket too big for one transaction
 * is delivered in parts). Those amounts leave the open payout; the leaf is spent once every leg it owes has landed.
 */
export async function recordDelivery(
  address: string,
  p: { epochId: number; account: string; amounts: bigint[]; signature: string; slot: number; ixIndex: number; legs?: number[] },
): Promise<void> {
  const c = await collections();
  const v = await loadVault(address);
  const n = v.basket.length;
  const legs = p.legs ?? p.amounts.map((_, i) => i);
  const sent = p.amounts.map((a, i) => (legs.includes(i) ? a : 0n));
  const allocated = bigs(v.allocated, n);
  sent.forEach((a, i) => (allocated[i] = allocated[i] > a ? allocated[i] - a : 0n));
  const now = new Date();
  const epoch = await c.epochs.findOne({ _id: epochDocId(address, p.epochId) });
  const claimedTotals = bigs(epoch?.claimedTotals, n).map((t, i) => t + sent[i]);
  await c.vaults.updateOne({ _id: vaultId(address) }, { $set: { allocated: strs(allocated), updatedAt: now } });
  await c.epochs.updateOne({ _id: epochDocId(address, p.epochId) }, { $set: { claimedTotals: strs(claimedTotals), updatedAt: now } });
  const leaf = await c.epochLeaves.findOne({ _id: leafId(address, p.epochId, p.account) }, { projection: { sentLegs: 1 } });
  const sentLegs = [...new Set([...(leaf?.sentLegs ?? []), ...legs])].sort((a, b) => a - b);
  const done = p.amounts.every((a, i) => a === 0n || sentLegs.includes(i));
  await c.epochLeaves.updateOne(
    { _id: leafId(address, p.epochId, p.account) },
    { $set: { sentLegs, pushSignature: p.signature, pushError: null, ...(done ? { claimed: true, claimedSignature: p.signature, claimedAt: now } : {}) } },
  );
  const doc: ClaimDoc = {
    _id: `${p.signature}:${p.ixIndex}`,
    cluster,
    vault: address,
    epochId: p.epochId,
    account: p.account,
    mints: v.basket.map((b) => b.mint),
    amounts: strs(sent),
    signature: p.signature,
    slot: p.slot,
    timestamp: now,
  };
  await c.claims.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
}

/** Cancel (inside the review window) or expire (after the claim window): what was not delivered returns to the pot. */
export async function closeCustodialEpoch(address: string, epochId: number, how: "cancelled" | "expired", signature: string | null): Promise<void> {
  const c = await collections();
  const v = await loadVault(address);
  const epoch = await c.epochs.findOne({ _id: epochDocId(address, epochId) });
  if (!epoch || epoch.status !== "published") throw new Error("epoch is not open");
  const n = v.basket.length;
  const remaining = bigs(epoch.amounts, n).map((a, i) => {
    const claimed = BigInt(epoch.claimedTotals?.[i] ?? "0");
    return a > claimed ? a - claimed : 0n;
  });
  const unallocated = bigs(v.unallocated, n).map((u, i) => u + remaining[i]);
  const allocated = bigs(v.allocated, n).map((a, i) => (a > remaining[i] ? a - remaining[i] : 0n));
  const now = new Date();
  await c.vaults.updateOne({ _id: vaultId(address) }, { $set: { unallocated: strs(unallocated), allocated: strs(allocated), updatedAt: now } });
  await c.epochs.updateOne({ _id: epochDocId(address, epochId) }, { $set: { status: how, closedSignature: signature, updatedAt: now } });
  // unspent leaves can no longer be delivered
  await c.epochLeaves.updateMany({ cluster, vault: address, epochId, claimed: false }, { $set: { pushError: how } });
}

export async function setCustodialAutoClaim(address: string, enabled: boolean): Promise<void> {
  const c = await collections();
  await c.vaults.updateOne({ _id: vaultId(address) }, { $set: { autoClaim: enabled, updatedAt: new Date() } });
}
