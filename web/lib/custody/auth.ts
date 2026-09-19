import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

/**
 * Wallet-signed actions for custodial vaults (there is no on-chain instruction to prove intent with). The wallet
 * signs a short human-readable message; the server checks the signature, the binding to a specific target and a
 * short freshness window so a captured signature cannot be replayed later.
 *
 *   message = `LINKR ${action} ${target} ${unixSeconds}`
 */
export interface SignedAction {
  pubkey: string;
  message: string;
  /** base58 ed25519 signature over the UTF-8 message bytes */
  signature: string;
}

/** Prefixes wallets signed under before: the first name, then the "Linkr" casing before the LINKR identity. */
const LEGACY_PREFIXES = ["CAUSA", "Linkr"];

export function actionMessage(action: string, target: string, at = Math.floor(Date.now() / 1000)): string {
  return `LINKR ${action} ${target} ${at}`;
}

export function verifySignedAction(
  p: SignedAction,
  expect: { action: string; target: string; maxAgeSeconds?: number },
): { ok: true; pubkey: string } | { ok: false; reason: string } {
  const parts = p.message.split(" ");
  // messages signed before a rename still start with the old name; they are accepted, and the freshness window
  // below retires them within minutes
  if (parts.length !== 4 || !["LINKR", ...LEGACY_PREFIXES].includes(parts[0])) return { ok: false, reason: "malformed message" };
  const [, action, target, ts] = parts;
  if (action !== expect.action) return { ok: false, reason: "wrong action" };
  if (target !== expect.target) return { ok: false, reason: "wrong target" };
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (!Number.isFinite(age) || age < -60 || age > (expect.maxAgeSeconds ?? 300)) return { ok: false, reason: "signature expired" };
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(p.pubkey);
  } catch {
    return { ok: false, reason: "invalid pubkey" };
  }
  try {
    const ok = ed25519.verify(bs58.decode(p.signature), new TextEncoder().encode(p.message), pubkey.toBytes());
    return ok ? { ok: true, pubkey: pubkey.toBase58() } : { ok: false, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "bad signature" };
  }
}
