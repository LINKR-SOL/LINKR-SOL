import { PublicKey, type ConfirmedSignatureInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { activeCluster } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { collections } from "../db/collections";
import type { BalanceChangeDoc, TransferStreamDoc } from "../db/types";
import { fetchParsed } from "./sync";

/**
 * Per-coin balance streams for launch mints bound to a vault. Each stream walks the mint's transaction history
 * (getSignaturesForAddress on the mint) and turns every transaction's pre/post token balances into signed
 * per-owner deltas. A stream runs in two directions: forward from its cursor to head every run, and backwards
 * from head to the coin's first transaction once (`backfilled`), so holders from before the bind still count.
 */

const cluster = activeCluster;
const PAGE = 1000;
/** Transactions ingested between cursor saves on the forward walk. */
const FORWARD_CHUNK = 25;

export interface StreamReport {
  mint: string;
  forward: number;
  backfill: number;
  changes: number;
  backfilled: boolean;
  caughtUp: boolean;
  error?: string;
}

interface Delta {
  owner: string;
  delta: bigint;
}

/** Per-owner deltas of `mint` in one transaction (token accounts of the same owner are merged). */
export function balanceDeltas(tx: ParsedTransactionWithMeta, mint: string): Delta[] {
  const meta = tx.meta;
  if (!meta || meta.err) return [];
  const byIndex = new Map<number, { pre: bigint; post: bigint; owner: string }>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.mint !== mint) continue;
    byIndex.set(b.accountIndex, { pre: BigInt(b.uiTokenAmount.amount), post: 0n, owner: b.owner ?? "" });
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.mint !== mint) continue;
    const cur = byIndex.get(b.accountIndex) ?? { pre: 0n, post: 0n, owner: b.owner ?? "" };
    cur.post = BigInt(b.uiTokenAmount.amount);
    cur.owner = b.owner ?? cur.owner;
    byIndex.set(b.accountIndex, cur);
  }
  const byOwner = new Map<string, bigint>();
  for (const v of byIndex.values()) {
    const d = v.post - v.pre;
    if (d !== 0n && v.owner) byOwner.set(v.owner, (byOwner.get(v.owner) ?? 0n) + d);
  }
  return [...byOwner].filter(([, d]) => d !== 0n).map(([owner, delta]) => ({ owner, delta }));
}

async function writeChanges(stream: TransferStreamDoc, sigs: ConfirmedSignatureInfo[], txs: (ParsedTransactionWithMeta | null)[]): Promise<number> {
  const c = await collections();
  const docs: BalanceChangeDoc[] = [];
  // position within a slot follows the order the RPC returns (oldest first after our reverse)
  let slot = -1;
  let index = 0;
  for (let k = 0; k < sigs.length; k++) {
    const tx = txs[k];
    const s = sigs[k];
    if (s.slot !== slot) {
      slot = s.slot;
      index = 0;
    } else {
      index++;
    }
    if (!tx || tx.meta?.err) continue;
    for (const d of balanceDeltas(tx, stream.mint)) {
      docs.push({
        _id: `${s.signature}:${d.owner}`,
        cluster,
        mint: stream.mint,
        owner: d.owner,
        delta: d.delta.toString(),
        slot: s.slot,
        index,
        signature: s.signature,
        timestamp: tx.blockTime ?? s.blockTime ?? 0,
      });
    }
  }
  if (docs.length) {
    await c.balanceChanges.bulkWrite(
      docs.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })),
      { ordered: false },
    );
  }
  return docs.length;
}

export async function syncBalanceStream(stream: TransferStreamDoc, opts: { budgetMs: number }): Promise<StreamReport> {
  const started = Date.now();
  const c = await collections();
  const connection = serverConnection();
  const mint = new PublicKey(stream.mint);
  const report: StreamReport = { mint: stream.mint, forward: 0, backfill: 0, changes: 0, backfilled: stream.backfilled, caughtUp: false };
  const remaining = () => opts.budgetMs - (Date.now() - started);
  let lastError: string | null = null;

  try {
    // 1. forward: everything newer than the cursor, oldest first. The head is read *before* the walk so the
    //    timestamp we record as "complete up to" can never overtake a transaction the walk did not see yet.
    const headSlot = await connection.getSlot("confirmed");
    const headTime = (await connection.getBlockTime(headSlot).catch(() => null)) ?? null;
    const fresh: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    // `walked`: the walk reached the cursor, so `fresh` is everything since it. The first page is always read: on a
    // throttled RPC the head lookups alone can use a stream's share of the budget, and a stream that never reads a
    // page never moves.
    let walked = false;
    do {
      const page = await connection.getSignaturesForAddress(mint, { before, until: stream.cursorSignature ?? undefined, limit: PAGE }, "confirmed");
      fresh.push(...page);
      if (page.length < PAGE) walked = true;
      else before = page[page.length - 1].signature;
    } while (!walked && remaining() > 0);
    fresh.reverse();
    // Ingested oldest first, a chunk at a time, the cursor moving after each: a run cut short by its budget or a rate
    // limit keeps what it did and the next one carries on. (All at once, a rate-limited RPC failed the same first
    // chunk every run and a coin with a few hundred transactions never synced.) A slot is never split across chunks.
    // A failed transaction moves no balances, so it is never fetched: on a sniped coin that is most of its history
    // (297 of MOON's first 404), and each fetch is what a throttled RPC rations.
    let done = 0;
    while (done < fresh.length && (done === 0 || remaining() > 0)) {
      let end = done;
      let fetches = 0;
      while (end < fresh.length && fetches < FORWARD_CHUNK) if (!fresh[end++].err) fetches++;
      while (end < fresh.length && fresh[end].slot === fresh[end - 1].slot) end++;
      const part = fresh.slice(done, end);
      const landed = part.filter((s) => !s.err);
      const txs = await fetchParsed(connection, landed.map((s) => s.signature));
      report.changes += await writeChanges(stream, landed, txs);
      report.forward += part.length;
      const newest = part[part.length - 1];
      const last = end === fresh.length;
      // the first forward pass seeds the backfill from the oldest signature it saw
      const seed = stream.backfillSignature === null && stream.cursorSignature === null;
      await c.transferStreams.updateOne(
        { _id: stream._id },
        {
          $set: {
            cursorSignature: newest.signature,
            cursorSlot: newest.slot,
            // "complete up to": a later slot can share this second, so a partial pass claims one second less
            cursorTimestamp: newest.blockTime == null ? null : newest.blockTime - (last ? 0 : 1),
            lastRunAt: new Date(),
            lastError: null,
            ...(seed ? { backfillSignature: part[0].signature, startSignature: null } : {}),
          },
        },
      );
      if (seed) stream.backfillSignature = part[0].signature;
      stream.cursorSignature = newest.signature;
      done = end;
    }
    if (done < fresh.length || !walked) return report;
    // A quiet mint still moves the "complete up to" clock: a walk that reached the cursor proves nothing else happened
    // before the head. (Only such a walk: one cut short proves nothing, and moving the clock then would let a payout
    // cover transfers not indexed yet.)
    if (headTime !== null && (stream.cursorSignature !== null || fresh.length)) {
      const newestTime = fresh.length ? fresh[fresh.length - 1].blockTime ?? 0 : 0;
      await c.transferStreams.updateOne(
        { _id: stream._id, $or: [{ cursorTimestamp: null }, { cursorTimestamp: { $lt: Math.max(headTime, newestTime) } }] },
        { $set: { cursorTimestamp: Math.max(headTime, newestTime), lastRunAt: new Date() } },
      );
    }
    report.caughtUp = true;

    // 2. backfill: older than the oldest we have, until the history runs out
    if (!stream.backfilled && stream.backfillSignature) {
      let cursor: string | null = stream.backfillSignature;
      // at least one page, for the same reason as the forward walk: most coins' history ends right there
      let first = true;
      while (cursor && (first || remaining() > 0)) {
        first = false;
        const page = await connection.getSignaturesForAddress(mint, { before: cursor, limit: PAGE }, "confirmed");
        if (page.length === 0) {
          await c.transferStreams.updateOne({ _id: stream._id }, { $set: { backfilled: true, startSignature: cursor, lastRunAt: new Date() } });
          report.backfilled = true;
          break;
        }
        const ordered = [...page].reverse().filter((s) => !s.err);
        const txs = await fetchParsed(connection, ordered.map((s) => s.signature));
        report.changes += await writeChanges(stream, ordered, txs);
        report.backfill += page.length;
        cursor = page[page.length - 1].signature;
        const done = page.length < PAGE;
        await c.transferStreams.updateOne(
          { _id: stream._id },
          { $set: { backfillSignature: cursor, ...(done ? { backfilled: true, startSignature: cursor, startSlot: page[page.length - 1].slot } : {}), lastRunAt: new Date() } },
        );
        if (done) {
          report.backfilled = true;
          break;
        }
      }
    }
  } catch (e) {
    lastError = String((e as Error).message ?? e).slice(0, 200);
    report.error = lastError;
    await c.transferStreams.updateOne({ _id: stream._id }, { $set: { lastRunAt: new Date(), lastError } });
  }
  return report;
}

/**
 * Advances every stream, splitting the budget evenly (streams that are already caught up return quickly). The one
 * that ran longest ago goes first, so on a throttled RPC, where one stream can use up a run, every stream still moves.
 */
export async function syncAllBalanceStreams(budgetMs: number): Promise<StreamReport[]> {
  const c = await collections();
  const streams = await c.transferStreams.find({ cluster }).sort({ lastRunAt: 1 }).toArray();
  if (streams.length === 0) return [];
  const started = Date.now();
  const out: StreamReport[] = [];
  for (let i = 0; i < streams.length; i++) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining <= 0) break;
    out.push(await syncBalanceStream(streams[i], { budgetMs: Math.floor(remaining / (streams.length - i)) }));
  }
  return out;
}
