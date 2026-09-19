import {
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  TransactionExpiredBlockheightExceededError,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";

export interface SendOptions {
  lookupTables?: AddressLookupTableAccount[];
  computeUnits?: number;
  /**
   * `"auto"` (the default): the price follows recent fees paid on the accounts this transaction writes, the CU limit
   * is fitted to the simulation so that price stays cheap, the transaction is rebroadcast until it lands or its
   * blockhash expires, and on expiry the chain is asked whether it landed after all. Every keeper transaction needs
   * this on mainnet: without it harvests and airdrops expired unlanded, and an "expired" one that did land in its last
   * slots would have been recorded as failed and sent again. Browser wallets do the equivalent for the web wizard.
   * A number (micro-lamports per CU, 0 = none) opts out, e.g. a withdrawal that sends a whole balance.
   */
  priorityFee?: number | "auto";
  extraSigners?: Keypair[];
  simulateFirst?: boolean;
}

/**
 * Bounds for the automatic price, micro-lamports per CU: a floor that still lands on a busy slot, and a cap on the
 * spend. With the limit fitted to the simulation (a LaunchLab create uses ~90k CU) the floor costs ~0.0001 SOL.
 */
const AUTO_FEE_FLOOR = 1_000_000;
const AUTO_FEE_CAP = 10_000_000;
const REBROADCAST_MS = 2_000;

/** 75th percentile of the recent non-zero fees paid to write-lock the accounts these instructions write. */
export async function autoPriorityFee(connection: Connection, payer: PublicKey, instructions: TransactionInstruction[]): Promise<number> {
  const writable = new Map<string, PublicKey>([[payer.toBase58(), payer]]);
  for (const ix of instructions) for (const k of ix.keys) if (k.isWritable) writable.set(k.pubkey.toBase58(), k.pubkey);
  const recent = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: [...writable.values()].slice(0, 128) }).catch(() => []);
  const paid = recent.map((f) => f.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
  const p75 = paid.length ? paid[Math.min(paid.length - 1, Math.floor(paid.length * 0.75))] : 0;
  return Math.min(Math.max(p75, AUTO_FEE_FLOOR), AUTO_FEE_CAP);
}

/** Signs and sends a v0 transaction from a server-side keypair, waiting for confirmation. Throws with logs. */
export async function sendKeeperTx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  opts: SendOptions = {},
): Promise<{ signature: string; slot: number }> {
  const auto = (opts.priorityFee ?? "auto") === "auto";
  const price = auto ? await autoPriorityFee(connection, payer.publicKey, instructions) : (opts.priorityFee as number);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const build = (units: number) => {
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
    if (price) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }));
    ixs.push(...instructions);
    const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(opts.lookupTables ?? []);
    const tx = new VersionedTransaction(message);
    tx.sign([payer, ...(opts.extraSigners ?? [])]);
    return tx;
  };
  const limit = opts.computeUnits ?? 600_000;
  let tx = build(limit);
  if (auto || (opts.simulateFirst ?? true)) {
    const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).slice(-12).join("\n")}`);
    // the fee is price × limit, so a limit fitted to what the transaction uses keeps a high price cheap
    // (with headroom: a swap route can use a little more against the pool state it meets when it lands)
    if (auto && sim.value.unitsConsumed) tx = build(Math.min(limit, Math.ceil(sim.value.unitsConsumed * 1.2) + 2_000));
  }
  const raw = tx.serialize();
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
  } catch (e) {
    if (e instanceof SendTransactionError) throw new Error(`${e.message}\n${(e.logs ?? []).slice(-12).join("\n")}`);
    throw e;
  }
  // keep the transaction in front of the leaders until it is confirmed or can no longer land (whatever its price: an
  // "expired" transaction is only reported as such once the chain confirms it never landed)
  let settled = false;
  const rebroadcast = (async () => {
    while (!settled) {
      await new Promise((r) => setTimeout(r, REBROADCAST_MS));
      if (!settled) await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
  })();
  try {
    const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (conf.value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(conf.value.err)}`);
    return { signature, slot: conf.context.slot };
  } catch (e) {
    if (!(e instanceof TransactionExpiredBlockheightExceededError)) throw e;
    // it may have landed in the last slots before expiry; the chain has the final word. Unknown now, it never will
    // land (its blockhash is too old); seen but not confirmed yet, it gets a few seconds to settle.
    for (let i = 0; i < 5; i++) {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value[0];
      if (!status) break;
      if (status.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return { signature, slot: status.slot };
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`transaction ${signature} expired before it landed (block height exceeded) — the network was congested; retry`);
  } finally {
    settled = true;
    await rebroadcast;
  }
}

/** Anchor error name from a thrown message, if any ("Error Message: X" or "custom program error"). */
export function anchorErrorName(e: unknown): string | null {
  const m = /Error Message: (.+?)\.?(\n|$)/.exec(String((e as Error)?.message ?? e));
  return m ? m[1] : null;
}
