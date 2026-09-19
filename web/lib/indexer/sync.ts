import type { ConfirmedSignatureInfo, Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { activeCluster, isCustodial, PROGRAM_ID } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { collections, ensureIndexes } from "../db/collections";
import type { SyncStateDoc } from "../db/types";
import { touchesProgram } from "./events";
import { ingestTransaction } from "./ingest";
import { refreshLaunches, refreshVaults } from "./refresh";

const cluster = activeCluster;
const STATE_ID = `program:${cluster}`;
/** Parsed transactions per RPC call. The public endpoints throttle batches hard; a paid one takes 100. */
const TX_BATCH = Number(process.env.INDEXER_TX_BATCH ?? 5);
const PAGE = 1000;
/** Full reconciliation (every vault re-read from chain) at least this often. */
const RECONCILE_EVERY_MS = 10 * 60_000;
let lastReconcileAt = 0;

export interface SyncReport {
  fromSignature: string | null;
  toSignature: string | null;
  headSlot: number;
  signatures: number;
  transactions: number;
  events: number;
  vaultsCreated: number;
  reconciled: boolean;
  caughtUp: boolean;
  ms: number;
}

async function loadState(): Promise<SyncStateDoc> {
  const c = await collections();
  const existing = await c.syncState.findOne({ _id: STATE_ID });
  if (existing) return existing;
  const doc: SyncStateDoc = { _id: STATE_ID, cluster, cursorSignature: null, cursorSlot: 0, lastRunAt: null, lastError: null, headSlotAtLastRun: null };
  await c.syncState.insertOne(doc);
  return doc;
}

/** All confirmed signatures for `address` newer than `until`, oldest first. Pages backwards from head. */
export async function signaturesSince(connection: Connection, address: import("@solana/web3.js").PublicKey, until: string | null, max = 20 * PAGE): Promise<ConfirmedSignatureInfo[]> {
  const all: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  while (all.length < max) {
    const page = await connection.getSignaturesForAddress(address, { before, until: until ?? undefined, limit: PAGE }, "confirmed");
    all.push(...page.filter((s) => !s.err));
    if (page.length < PAGE) break;
    before = page[page.length - 1].signature;
  }
  return all.reverse();
}

/** Parsed transactions in small batches, in the given order; nulls for anything the RPC no longer has. */
export async function fetchParsed(connection: Connection, signatures: string[]): Promise<(ParsedTransactionWithMeta | null)[]> {
  // Batched JSON-RPC responses are not guaranteed to come back in request order (devnet's public RPC does
  // shuffle them), so every result is re-aligned by its own signature rather than by position.
  const bySig = new Map<string, ParsedTransactionWithMeta>();
  for (let i = 0; i < signatures.length; i += TX_BATCH) {
    const chunk = signatures.slice(i, i + TX_BATCH);
    const txs = await rateLimited(() => connection.getParsedTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }));
    for (const tx of txs) {
      const sig = tx?.transaction.signatures[0];
      if (tx && sig) bySig.set(sig, tx);
    }
  }
  return signatures.map((s) => bySig.get(s) ?? null);
}

/**
 * Retries `fn` while the RPC answers "too many requests", backing off 0.5 s → 8 s. web3.js retries single calls on
 * a 429 itself but not batches, and one throttled batch used to fail a whole sync.
 */
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 5 || !/429|too many requests/i.test(String((e as Error)?.message ?? e))) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/**
 * Walks every program transaction newer than the cursor, oldest first, and ingests its events. Every write is
 * idempotent and the cursor only moves forward once everything older is in, so an interrupted run resumes cleanly.
 */
export async function runRangeSync(opts: { budgetMs?: number } = {}): Promise<SyncReport> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  await ensureIndexes();
  const c = await collections();
  const connection = serverConnection();
  const state = await loadState();
  const headSlot = await connection.getSlot("confirmed");
  if (isCustodial) {
    // no program on this deployment: vault state is written by the custodial keeper; only the live balances need a refresh
    const { refreshVaults } = await import("./refresh");
    await refreshVaults();
    return {
      fromSignature: state.cursorSignature, toSignature: state.cursorSignature, headSlot, signatures: 0, transactions: 0, events: 0,
      vaultsCreated: 0, reconciled: true, caughtUp: true, ms: Date.now() - started,
    };
  }
  const report: SyncReport = {
    fromSignature: state.cursorSignature, toSignature: state.cursorSignature, headSlot, signatures: 0, transactions: 0, events: 0,
    vaultsCreated: 0, reconciled: false, caughtUp: false, ms: 0,
  };

  const sigs = await signaturesSince(connection, PROGRAM_ID, state.cursorSignature);
  report.signatures = sigs.length;
  const launchesTouched = new Set<string>();
  const vaultsTouched = new Set<string>();
  let lastError: string | null = null;
  let cursor = state.cursorSignature;
  let cursorSlot = state.cursorSlot;

  for (let i = 0; i < sigs.length && Date.now() - started < budgetMs; i += TX_BATCH) {
    const batch = sigs.slice(i, i + TX_BATCH);
    let txs: (ParsedTransactionWithMeta | null)[];
    try {
      txs = await fetchParsed(connection, batch.map((s) => s.signature));
    } catch (e) {
      lastError = String((e as Error).message ?? e).slice(0, 200);
      break;
    }
    for (let k = 0; k < batch.length; k++) {
      const tx = txs[k];
      if (tx && !tx.meta?.err && touchesProgram(tx)) {
        const res = await ingestTransaction(tx, batch[k].signature);
        res.launchesTouched.forEach((m) => launchesTouched.add(m));
        res.vaultsTouched.forEach((v) => vaultsTouched.add(v));
        report.vaultsCreated += res.vaultsCreated.length;
        report.events += res.events;
        report.transactions++;
      }
      cursor = batch[k].signature;
      cursorSlot = batch[k].slot;
    }
    await c.syncState.updateOne(
      { _id: STATE_ID },
      { $set: { cursorSignature: cursor, cursorSlot, lastRunAt: new Date(), lastError, headSlotAtLastRun: headSlot } },
    );
  }
  report.toSignature = cursor;
  report.caughtUp = cursor === (sigs.length ? sigs[sigs.length - 1].signature : state.cursorSignature);

  if (launchesTouched.size) await refreshLaunches([...launchesTouched]);
  // Vaults: touched ones every run, all of them on reconcile (creator-vault balances change without any vault event).
  if (Date.now() - lastReconcileAt >= RECONCILE_EVERY_MS) {
    await refreshVaults();
    lastReconcileAt = Date.now();
    report.reconciled = true;
  } else if (vaultsTouched.size) {
    await refreshVaults([...vaultsTouched]);
  }
  report.ms = Date.now() - started;
  return report;
}

/** Re-ingests every program transaction between two signatures (admin repair). Idempotent; never moves the cursor. */
export async function resyncRange(opts: { until?: string | null; max?: number } = {}): Promise<SyncReport> {
  const started = Date.now();
  await ensureIndexes();
  const connection = serverConnection();
  const sigs = await signaturesSince(connection, PROGRAM_ID, opts.until ?? null, opts.max ?? 5 * PAGE);
  const report: SyncReport = {
    fromSignature: sigs[0]?.signature ?? null, toSignature: sigs[sigs.length - 1]?.signature ?? null, headSlot: await connection.getSlot(),
    signatures: sigs.length, transactions: 0, events: 0, vaultsCreated: 0, reconciled: true, caughtUp: true, ms: 0,
  };
  const launchesTouched = new Set<string>();
  const vaultsTouched = new Set<string>();
  const txs = await fetchParsed(connection, sigs.map((s) => s.signature));
  for (let k = 0; k < sigs.length; k++) {
    const tx = txs[k];
    if (!tx || tx.meta?.err || !touchesProgram(tx)) continue;
    const res = await ingestTransaction(tx, sigs[k].signature);
    res.launchesTouched.forEach((m) => launchesTouched.add(m));
    res.vaultsTouched.forEach((v) => vaultsTouched.add(v));
    report.vaultsCreated += res.vaultsCreated.length;
    report.events += res.events;
    report.transactions++;
  }
  if (launchesTouched.size) await refreshLaunches([...launchesTouched]);
  await refreshVaults();
  report.ms = Date.now() - started;
  return report;
}
