import { Decimal128, ObjectId } from "mongodb";
import { PublicKey } from "@solana/web3.js";

/** Converts Mongo documents to JSON-safe values: Decimal128 -> string, Date -> ISO, bigint -> string. */
export function toJson<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Decimal128) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJson(v);
    return out;
  }
  return value;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(toJson(data), init);
}

export function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export { isBase58Address, isBase58Signature } from "./solana/address";
