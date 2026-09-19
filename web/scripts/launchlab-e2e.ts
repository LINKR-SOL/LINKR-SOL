/**
 * Devnet end-to-end for custodial mode on LaunchLab (NEXT_PUBLIC_VAULT_MODE=custodial in .env.local):
 * register a vault via the API → fund its floor + token accounts → LaunchLab create with the vault as creator
 * (+ dev buy) → a second holder buys → keeper loop (bind → stream → claim on-chain creator fee → harvest →
 * mock swap → publish → deliver) until the holder has received basket tokens.
 *
 * Run from web/ with the dev server up on APP_URL (default http://localhost:3001):  npx tsx scripts/launchlab-e2e.ts
 * Needs: ~/.config/solana/id.json with ~0.3 SOL (devnet), KEEPER_PRIVATE_KEY, LAUNCHLAB_PLATFORM_ID (LINKR's devnet
 * platform, see scripts/launchlab-devnet-platform.ts), DIVIDEND_SWAP=mock, BASKET_ALLOWLIST with a mock mint the
 * keeper is authority of. QUOTE=<mint> launches against another devnet quote (default SOL).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
const APP = process.env.APP_URL ?? "http://localhost:3001";
const QUOTE = process.env.QUOTE ?? "So11111111111111111111111111111111111111112";
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${APP}${pathname}`, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${pathname}: ${body.error ?? res.status}`);
  return body;
}

async function main() {
  const [{ activeCluster, publicRpcUrl, VAULT_MODE }, { runDividendKeeper }, { createLaunchIx, buyIxs, tradeParamsFromPricing }, { fetchLaunchpadPoolFor }] = await Promise.all([
    import("../lib/solana/cluster"),
    import("../lib/indexer/dividendKeeper"),
    import("../lib/launchlab/tx"),
    import("../lib/launchlab/pool"),
  ]);
  type Pricing = import("../lib/launchlab/pricing").LaunchPricing;
  if (VAULT_MODE !== "custodial") throw new Error("set NEXT_PUBLIC_VAULT_MODE=custodial in .env.local");
  const connection = new Connection(publicRpcUrl, "confirmed");
  const send = (ixs: Parameters<Transaction["add"]>, signers: Keypair[], cu = 600_000) =>
    sendAndConfirmTransaction(connection, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs), signers, { commitment: "confirmed" });
  log(`cluster ${activeCluster} · custodial · admin ${admin.publicKey.toBase58()} · ${(await connection.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // 0. allowlisted basket + the quote's pricing from the running app
  const cfg = await api<{ basketTokens: { mint: string; tokenProgram: string }[]; minEpochLength: number }>("/api/vaults/config");
  if (!cfg.basketTokens?.length) throw new Error("BASKET_ALLOWLIST resolves to nothing");
  const leg = cfg.basketTokens[0];
  const pricing = await api<Pricing>(`/api/launch/pricing?quote=${QUOTE}`);
  log(`basket leg ${leg.mint}, min period ${cfg.minEpochLength}s · quote ${pricing.quote.symbol} · platform ${pricing.platformId} · raise ${pricing.totalFundRaisingB} · fees ${JSON.stringify(pricing.fees)}`);

  // 1. register the vault
  const coin = Keypair.generate();
  const salt = String(Date.now());
  const created = await api<{ address: string; floorLamports: string; quote: { mint: string; tokenProgram: string } }>("/api/vaults/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creator: admin.publicKey.toBase58(), salt, legs: [{ mint: leg.mint, tokenProgram: leg.tokenProgram }], weightsBps: [10_000], epochLength: cfg.minEpochLength, expectedMint: coin.publicKey.toBase58(), quoteMint: QUOTE }),
  });
  const vault = new PublicKey(created.address);
  log(`vault ${vault.toBase58()} (floor ${created.floorLamports} lamports)`);
  const { setCustodialAutoClaim } = await import("../lib/custody/ledger");
  const { deliverNow } = await import("../lib/custody/keeper");

  // 2. prepare: floor + leg ATA (+ quote ATA for a token quote), paid by the creator
  const legMint = new PublicKey(leg.mint);
  const legTp = new PublicKey(leg.tokenProgram);
  const prep = [
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: vault, lamports: Number(created.floorLamports) }),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, getAssociatedTokenAddressSync(legMint, vault, true, legTp), vault, legMint, legTp),
  ];
  const qm = new PublicKey(created.quote.mint);
  const qp = new PublicKey(created.quote.tokenProgram);
  const vaultQuoteAta = getAssociatedTokenAddressSync(qm, vault, true, qp);
  prep.push(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, vaultQuoteAta, vault, qm, qp));
  log("prepare", await send(prep, [admin], 200_000));

  // 3. LaunchLab create with the vault as creator + dev buy (the pool's first trade)
  const before = await connection.getBalance(admin.publicKey);
  const devBuy = BigInt(Math.round(0.05 * 10 ** pricing.quote.decimals));
  const name = "LINKR launchlab e2e";
  const symbol = "CLE2E";
  const uri = "https://causa.example/e2e.json";
  const launchIxs = [createLaunchIx({ pricing, payer: admin.publicKey, creator: vault, mint: coin.publicKey, name, symbol, uri }), ...buyIxs(tradeParamsFromPricing(pricing, coin.publicKey, vault, admin.publicKey), devBuy, 1n)];
  const launchSig = await send(launchIxs, [admin, coin]);
  const after = await connection.getBalance(admin.publicKey);
  log(`create + dev buy ${coin.publicKey.toBase58()} ${launchSig} · cost ${(before - after) / LAMPORTS_PER_SOL} SOL incl. ${Number(devBuy) / 10 ** pricing.quote.decimals} ${pricing.quote.symbol} dev buy`);
  const pool = await fetchLaunchpadPoolFor(connection, coin.publicKey, new PublicKey(QUOTE));
  if (!pool) throw new Error("pool not found after create");
  log(`pool ${pool.address} creator=${pool.creator} (${pool.creator === vault.toBase58() ? "vault ✓" : "NOT the vault ✗"}) status=${pool.status} realB=${pool.realB}`);
  await api("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint: coin.publicKey.toBase58(), quoteMint: QUOTE, name, symbol, uri, deployer: admin.publicKey.toBase58(), signature: launchSig }) }).catch((e) => log("register:", (e as Error).message));

  // 4. a second holder
  const holder = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: holder.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })], [admin], 50_000);
  const holderBuy = BigInt(Math.round(0.02 * 10 ** pricing.quote.decimals));
  const params = { ...tradeParamsFromPricing(pricing, coin.publicKey, vault, holder.publicKey), configId: new PublicKey(pool.configId), platformId: new PublicKey(pool.platformId) };
  log("holder bought", holder.publicKey.toBase58(), await send(buyIxs(params, holderBuy, 1n), [holder], 400_000));

  // 4b. what StonkFun's sweeper does on mainnet: a token transfer into the creator's quote account (WSOL for SOL)
  if (QUOTE === "So11111111111111111111111111111111111111112") {
    const forwarded = 0.0004 * LAMPORTS_PER_SOL;
    log("simulate StonkFun forward", await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: vaultQuoteAta, lamports: forwarded }), createSyncNativeInstruction(vaultQuoteAta)], [admin], 50_000), `${forwarded} lamports wrapped into the vault's WSOL account`);
  }

  // 5. keeper loop until the holder holds basket tokens. The admin's share is delivered automatically (creator
  //    switch on), the holder's through the "Claim" path (what the Claims page calls), so both are exercised.
  const holderAta = getAssociatedTokenAddressSync(legMint, holder.publicKey, false, legTp);
  await setCustodialAutoClaim(vault.toBase58(), true);
  for (let round = 1; round <= 30; round++) {
    const rep = await runDividendKeeper({ budgetMs: 120_000 });
    if (rep.published.length || round % 3 === 0) {
      try {
        const d = await deliverNow(vault.toBase58(), holder.publicKey.toBase58());
        if (d.length) log("holder claim delivered", d[0].signature);
      } catch (e) {
        log("holder claim:", (e as Error).message);
      }
    }
    log(`round ${round}: keeper vaults=${rep.vaults} bound=${rep.bound.length} streams=${rep.streams.map((s) => `${s.forward}/${s.backfill}${s.backfilled ? "✓" : ""}`).join(",")} harvested=${rep.harvested.map((h) => `${h.input}(${h.swaps.length} swaps)`).join(",") || 0} published=${rep.published.length} delivered=${rep.delivered.length}${rep.skipped.length ? ` skipped=${rep.skipped.map((s) => `${s.step}:${s.reason}`).join(" | ")}` : ""}${rep.reason ? ` (${rep.reason})` : ""}`);
    const got = await connection.getTokenAccountBalance(holderAta).then((r) => BigInt(r.value.amount)).catch(() => 0n);
    if (got > 0n) {
      log(`PASS: holder received ${got} raw units. vault ${vault.toBase58()}, coin ${coin.publicKey.toBase58()}`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  log("FAIL: no delivery within the time budget");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
