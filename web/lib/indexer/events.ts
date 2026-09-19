import type { ParsedTransactionWithMeta, PartiallyDecodedInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { coder } from "../solana/program";
import { PROGRAM_ID } from "../solana/cluster";

/**
 * causa_vault emits events with `emit_cpi!`: each one is a self-CPI whose instruction data is
 * [event-cpi tag (8)] [event discriminator (8)] [borsh payload]. They live in the transaction's inner
 * instructions, not in "Program data:" logs, which makes them immune to log truncation.
 */
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

export const INDEXED_EVENT_NAMES = [
  "VaultCreated",
  "LaunchBound",
  "Harvested",
  "SwapSettled",
  "EpochPublished",
  "EpochCancelled",
  "EpochExpired",
  "Claimed",
  "AutoClaimUpdated",
  "Rescued",
  "ConfigUpdated",
  "BasketMintUpdated",
] as const;

export type IndexedEventName = (typeof INDEXED_EVENT_NAMES)[number];

export interface DecodedEvent {
  name: IndexedEventName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  /** index of the outer instruction this event was emitted under */
  ixIndex: number;
  /** position of the event within the transaction (stable ordering key with ixIndex) */
  order: number;
}

/** The event coder keeps the IDL's snake_case field names (unlike accounts); the handlers read camelCase. */
function camelKeys(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), v]));
}

function isOurs(ix: { programId: { toBase58(): string } }): ix is PartiallyDecodedInstruction {
  return ix.programId.toBase58() === PROGRAM_ID.toBase58() && "data" in ix;
}

/** Decodes every causa_vault event in a confirmed transaction, in execution order. */
export function decodeEvents(tx: ParsedTransactionWithMeta): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  let order = 0;
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if (!isOurs(ix)) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const decoded = coder.events.decode(data.subarray(8).toString("base64"));
      if (!decoded || !(INDEXED_EVENT_NAMES as readonly string[]).includes(decoded.name)) continue;
      out.push({ name: decoded.name as IndexedEventName, data: camelKeys(decoded.data as Record<string, unknown>), ixIndex: inner.index, order: order++ });
    }
  }
  return out;
}

/** True when the transaction touched our program at all (outer or inner). */
export function touchesProgram(tx: ParsedTransactionWithMeta): boolean {
  const pid = PROGRAM_ID.toBase58();
  if (tx.transaction.message.instructions.some((ix) => ix.programId.toBase58() === pid)) return true;
  return (tx.meta?.innerInstructions ?? []).some((i) => i.instructions.some((ix) => ix.programId.toBase58() === pid));
}
