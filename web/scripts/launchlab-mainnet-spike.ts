/**
 * Mainnet spike (~0.03 SOL): proves the two things devnet cannot — that StonkFun adopts a LaunchLab pool whose
 * `creator` is not the payer, and that it forwards the creator's share of the curve fee to that creator.
 *
 * One real launch against SOL with a throwaway creator wallet, a dev buy, a second buy, a wait for StonkFun's
 * sweeper, then a sell of everything bought to recover most of the SOL. No vault, no database: only the venue.
 *
 * Run from web/:  ENV_FILE=.env.mainnet.local npx tsx scripts/launchlab-mainnet-spike.ts
 * Pays from KEEPER_PRIVATE_KEY in that file. Prints the creator wallet so it can be watched afterwards too.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const file = process.env.ENV_FILE ?? ".env.mainnet.local";
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*?)\s*(#.*)?$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const DEV_BUY = Number(process.env.SPIKE_DEV_BUY ?? "0.02");
const SECOND_BUY = Number(process.env.SPIKE_SECOND_BUY ?? "0.03");
const WAIT_MIN = Number(process.env.SPIKE_WAIT_MIN ?? "12");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const [{ activeCluster, publicRpcUrl }, { keeperKeypair }, { launchPricing }, { createLaunchIx, buyIxs, sellIxs, tradeParamsFromPricing }, { fetchLaunchpadPoolFor, creatorFeeVault }, { STONKFUN_API, TOKEN_2022_PROGRAM_ID }] = await Promise.all([
    import("../lib/solana/cluster"),
    import("../lib/solana/keeper"),
    import("../lib/launchlab/pricing"),
    import("../lib/launchlab/tx"),
    import("../lib/launchlab/pool"),
    import("../lib/launchlab/ids"),
  ]);
  if (activeCluster !== "mainnet-beta") throw new Error(`this spike is for mainnet; ${file} says ${activeCluster}`);
  const payer = keeperKeypair();
  if (!payer) throw new Error("KEEPER_PRIVATE_KEY not set");
  const connection = new Connection(publicRpcUrl, "confirmed");
  const send = (ixs: Parameters<Transaction["add"]>, signers: Keypair[], cu = 600_000) =>
    sendAndConfirmTransaction(connection, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ...ixs), signers, { commitment: "confirmed" });

  const start = await connection.getBalance(payer.publicKey);
  log(`mainnet · payer ${payer.publicKey.toBase58()} · ${start / LAMPORTS_PER_SOL} SOL`);
  if (start < 0.08 * LAMPORTS_PER_SOL) throw new Error("fund the payer with at least 0.08 SOL first");

  // the creator: a wallet nobody pays with, so forwarding to it is unambiguous
  const creatorPath = path.join(os.homedir(), ".config/solana/linkr-spike-creator.json");
  const creator = fs.existsSync(creatorPath) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(creatorPath, "utf8")))) : Keypair.generate();
  fs.writeFileSync(creatorPath, JSON.stringify(Array.from(creator.secretKey)), { mode: 0o600 });
  const creatorBefore = await connection.getBalance(creator.publicKey);
  log(`creator ${creator.publicKey.toBase58()} (${creatorBefore} lamports before)`);

  // 1. price + create + dev buy in one transaction
  const pricing = await launchPricing("So11111111111111111111111111111111111111112");
  log(`pricing from ${pricing.source}: platform ${pricing.platformId} · config ${pricing.configId} · curve rule ${pricing.curveRuleId} · raise ${pricing.totalFundRaisingB} · fees ${JSON.stringify(pricing.fees)}`);
  const mint = Keypair.generate();
  const name = "LINKR spike";
  const symbol = "CSPIKE";
  const uri = "https://linkrfun.xyz/spike.json";
  const devBuy = BigInt(Math.round(DEV_BUY * LAMPORTS_PER_SOL));
  const ixs = [createLaunchIx({ pricing, payer: payer.publicKey, creator: creator.publicKey, mint: mint.publicKey, name, symbol, uri }), ...buyIxs(tradeParamsFromPricing(pricing, mint.publicKey, creator.publicKey, payer.publicKey), devBuy, 1n)];
  const sig = await send(ixs, [payer, mint]);
  const afterCreate = await connection.getBalance(payer.publicKey);
  log(`created ${mint.publicKey.toBase58()} in ${sig} · spent ${(start - afterCreate) / LAMPORTS_PER_SOL} SOL incl. ${DEV_BUY} SOL dev buy`);
  const pool = await fetchLaunchpadPoolFor(connection, mint.publicKey, new PublicKey(pricing.quote.mint));
  if (!pool) throw new Error("pool not found after create");
  log(`pool ${pool.address} creator=${pool.creator} (${pool.creator === creator.publicKey.toBase58() ? "creator ✓" : "NOT the creator ✗"}) platform=${pool.platformId}`);

  // 2. wait for StonkFun to adopt the pool
  let adopted: Record<string, unknown> | null = null;
  for (let i = 0; i < 30 && !adopted; i++) {
    const res = await fetch(`${STONKFUN_API}/tokens/${mint.publicKey.toBase58()}`, { headers: { accept: "application/json" } }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { data?: { token?: Record<string, unknown> } };
      if (body.data?.token?.launchpad) adopted = body.data.token;
    }
    if (!adopted) await new Promise((r) => setTimeout(r, 10_000));
  }
  log(adopted ? `ADOPTED ✓ launchpad=${adopted.launchpad} mode=${adopted.mode} status=${adopted.status} page https://www.stonkfun.xyz/token/${mint.publicKey.toBase58()}` : "NOT ADOPTED ✗ after 5 minutes (the pool trades on Raydium regardless)");

  // 3. a second buy, so there is a fee to forward
  const params = tradeParamsFromPricing(pricing, mint.publicKey, creator.publicKey, payer.publicKey);
  const secondBuy = BigInt(Math.round(SECOND_BUY * LAMPORTS_PER_SOL));
  log(`second buy ${SECOND_BUY} SOL`, await send(buyIxs(params, secondBuy, 1n), [payer], 400_000));
  const traded = DEV_BUY + SECOND_BUY;
  log(`expected creator share: 0.5% of ${traded} SOL = ${(traded * 0.005).toFixed(6)} SOL (${Math.round(traded * 0.005 * LAMPORTS_PER_SOL)} lamports)`);

  // 4. watch the creator wallet (and the on-chain fee vault, which StonkFun's platform should leave at 0)
  // StonkFun forwards as a token transfer into the creator's quote account — wrapped SOL here — so open it first
  const creatorWsol = getAssociatedTokenAddressSync(new PublicKey(pricing.quote.mint), creator.publicKey, true);
  await send([createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, creatorWsol, creator.publicKey, new PublicKey(pricing.quote.mint))], [payer], 50_000);
  const feeVault = creatorFeeVault(creator.publicKey, new PublicKey(pricing.quote.mint));
  let forwarded = 0;
  for (let i = 0; i < WAIT_MIN * 6; i++) {
    const [bal, wrapped, fv] = await Promise.all([
      connection.getBalance(creator.publicKey),
      connection.getTokenAccountBalance(creatorWsol).then((r) => Number(r.value.amount)).catch(() => 0),
      connection.getTokenAccountBalance(feeVault).then((r) => Number(r.value.amount)).catch(() => 0),
    ]);
    forwarded = bal - creatorBefore + wrapped;
    if (forwarded > 0) {
      log(`FORWARDED ✓ creator received ${forwarded} lamports (${forwarded / LAMPORTS_PER_SOL} SOL) after ${Math.round((i * 10) / 60)} min · on-chain fee vault ${fv}`);
      break;
    }
    if (i % 6 === 0) log(`waiting for the sweeper… creator ${bal} lamports, on-chain fee vault ${fv} (${Math.round(i / 6)} min)`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (forwarded <= 0) log(`NOT FORWARDED yet after ${WAIT_MIN} min — keep watching ${creator.publicKey.toBase58()}`);

  // 5. sell everything back
  const ata = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const held = await connection.getTokenAccountBalance(ata).then((r) => BigInt(r.value.amount)).catch(() => 0n);
  if (held > 0n) log(`sold ${held} raw`, await send(sellIxs(params, held, 1n), [payer], 400_000));
  const end = await connection.getBalance(payer.publicKey);
  log(`done · net cost ${(start - end) / LAMPORTS_PER_SOL} SOL · adopted=${!!adopted} forwarded=${forwarded > 0 ? forwarded + " lamports" : "no"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
