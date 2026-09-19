import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { actionMessage, verifySignedAction } from "./auth";

const kp = Keypair.generate();
const sign = (message: string) => ({ pubkey: kp.publicKey.toBase58(), message, signature: bs58.encode(ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32))) });

describe("wallet-signed actions", () => {
  it("signs as LINKR and verifies", () => {
    const m = actionMessage("claim", "Vault1");
    expect(m.startsWith("LINKR claim Vault1 ")).toBe(true);
    expect(verifySignedAction(sign(m), { action: "claim", target: "Vault1" })).toEqual({ ok: true, pubkey: kp.publicKey.toBase58() });
  });

  it("still accepts a message signed under an earlier name while it is fresh", () => {
    for (const prefix of ["CAUSA", "Linkr"]) {
      const m = `${prefix} claim Vault1 ${Math.floor(Date.now() / 1000)}`;
      expect(verifySignedAction(sign(m), { action: "claim", target: "Vault1" }).ok).toBe(true);
    }
  });

  it("rejects another prefix, a wrong target, a stale message and a forged signature", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySignedAction(sign(`OTHER claim Vault1 ${now}`), { action: "claim", target: "Vault1" }).ok).toBe(false);
    expect(verifySignedAction(sign(`LINKR claim Vault2 ${now}`), { action: "claim", target: "Vault1" }).ok).toBe(false);
    expect(verifySignedAction(sign(`LINKR claim Vault1 ${now - 3600}`), { action: "claim", target: "Vault1" }).ok).toBe(false);
    const forged = { ...sign(`LINKR claim Vault1 ${now}`), pubkey: Keypair.generate().publicKey.toBase58() };
    expect(verifySignedAction(forged, { action: "claim", target: "Vault1" }).ok).toBe(false);
  });
});
