import { PublicKey } from "@solana/web3.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** A syntactically valid Solana account address (32 bytes, base58). Safe to import from client components. */
export function isBase58Address(s: string | null | undefined): s is string {
  if (!s || !BASE58.test(s) || s.length < 32 || s.length > 44) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

/** A transaction signature (64 bytes, base58: 86–88 characters). */
export function isBase58Signature(s: string | null | undefined): s is string {
  return !!s && BASE58.test(s) && s.length >= 86 && s.length <= 88;
}
