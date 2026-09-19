import { afterEach, describe, expect, it } from "vitest";
import { draftMint, userWallet } from "./wallets";

const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

describe("Telegram bot wallets", () => {
  afterEach(() => {
    process.env.TELEGRAM_WALLET_SECRET = SECRET;
  });

  it("derives the same wallet for the same user, a different one per user", () => {
    process.env.TELEGRAM_WALLET_SECRET = SECRET;
    expect(userWallet(42).publicKey.toBase58()).toBe(userWallet(42).publicKey.toBase58());
    expect(userWallet(42).publicKey.toBase58()).not.toBe(userWallet(43).publicKey.toBase58());
  });

  it("a user's wallet and a draft's mint never collide", () => {
    process.env.TELEGRAM_WALLET_SECRET = SECRET;
    expect(draftMint("42").publicKey.toBase58()).not.toBe(userWallet(42).publicKey.toBase58());
    expect(draftMint("abc").publicKey.toBase58()).toBe(draftMint("abc").publicKey.toBase58());
  });

  it("depends on the secret, and refuses a missing or short one", () => {
    process.env.TELEGRAM_WALLET_SECRET = SECRET;
    const a = userWallet(42).publicKey.toBase58();
    process.env.TELEGRAM_WALLET_SECRET = `${SECRET}-other`;
    expect(userWallet(42).publicKey.toBase58()).not.toBe(a);
    process.env.TELEGRAM_WALLET_SECRET = "short";
    expect(() => userWallet(42)).toThrow(/TELEGRAM_WALLET_SECRET/);
    delete process.env.TELEGRAM_WALLET_SECRET;
    expect(() => userWallet(42)).toThrow(/TELEGRAM_WALLET_SECRET/);
  });
});
