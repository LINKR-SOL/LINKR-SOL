import { ensureIndexes } from "../db/collections";
import { serverConnection } from "../solana/connection";
import { touchesProgram } from "./events";
import { ingestTransaction, type IngestResult } from "./ingest";
import { refreshLaunches, refreshVaults } from "./refresh";

export type TxIngestResult =
  | { status: "not_found" }
  | { status: "ignored"; reason: string }
  | ({ status: "ingested" } & IngestResult);

/**
 * On-demand ingestion of a single transaction, called by the frontend right after confirmation so the UI
 * reflects the user's own action without waiting for the cron. Only causa_vault events are accepted.
 */
export async function ingestTx(signature: string): Promise<TxIngestResult> {
  await ensureIndexes();
  const connection = serverConnection();
  const tx = await connection
    .getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
    .catch(() => null);
  if (!tx) return { status: "not_found" };
  if (tx.meta?.err) return { status: "ignored", reason: "transaction failed" };
  if (!touchesProgram(tx)) return { status: "ignored", reason: "not a LINKR transaction" };
  const res = await ingestTransaction(tx, signature);
  if (res.launchesTouched.length === 0 && res.vaultsTouched.length === 0) return { status: "ignored", reason: "no LINKR events" };
  if (res.launchesTouched.length) await refreshLaunches(res.launchesTouched);
  if (res.vaultsTouched.length) await refreshVaults(res.vaultsTouched);
  return { status: "ingested", ...res };
}
