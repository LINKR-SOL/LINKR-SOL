import { Keypair } from "@solana/web3.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { envValue } from "../solana/cluster";

/**
 * Bot wallets. Every Telegram user gets a Solana keypair derived from TELEGRAM_WALLET_SECRET and their Telegram
 * user id, the same way custodial vaults are derived from the keeper's secret: nothing is stored, and the one
 * secret is what has to be backed up. Losing it loses every bot wallet; leaking it exposes every bot wallet —
 * treat it exactly like KEEPER_PRIVATE_KEY, and keep it different from it.
 *
 * A bot launch's coin mint is derived the same way from its draft id, so a retry after a crash signs with the
 * same mint the vault already committed to, without the mint's secret ever being written anywhere.
 */

const encoder = new TextEncoder();

function secret(): Uint8Array {
  const s = envValue("TELEGRAM_WALLET_SECRET");
  if (!s || s.length < 32) throw new Error("TELEGRAM_WALLET_SECRET is not set (use 32+ random characters, e.g. `openssl rand -base64 48`)");
  return encoder.encode(s);
}

const derive = (label: string) => Keypair.fromSeed(hmac(sha256, secret(), encoder.encode(label)));

export const userWallet = (tgUserId: number): Keypair => derive(`causa-telegram-wallet-v1:${tgUserId}`);

export const draftMint = (draftId: string): Keypair => derive(`causa-telegram-mint-v1:${draftId}`);
