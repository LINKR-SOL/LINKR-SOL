// Spike 1: can a program-derived address be the pump.fun `creator`, and can a third party sweep its fees?
//
//   1. create_v2 + initial buy with creator = an off-curve PDA (nobody can sign for it)
//   2. a second wallet buys on the curve, so creator fees accrue
//   3. a third wallet (not the creator, not the payer) calls collect_creator_fee — permissionless
//   4. assert the lamports landed on the PDA itself
//
// Run: RPC_URL=https://api.devnet.solana.com npm run spike1   (payer = ~/.config/solana/id.json)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  OnlinePumpSdk,
  PumpSdk,
  bondingCurvePda,
  creatorVaultPda,
  getBuyTokenAmountFromSolAmount,
} from "@pump-fun/pump-sdk";
import BN from "bn.js";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");
const sdk = new PumpSdk();
const online = new OnlinePumpSdk(connection);

function loadPayer(): Keypair {
  const p = path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

const sol = (lamports: number | bigint | BN) => Number(lamports.toString()) / LAMPORTS_PER_SOL;

async function send(label: string, tx: Transaction, signers: Keypair[]) {
  const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
  console.log(`  ${label}: ${sig}`);
  return sig;
}

async function fund(from: Keypair, to: PublicKey, lamports: number) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }));
  await send(`fund ${to.toBase58().slice(0, 6)}…`, tx, [from]);
}

async function main() {
  const payer = loadPayer();
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`payer ${payer.publicKey.toBase58()} balance ${sol(balance)} SOL on ${RPC}`);
  if (balance < 0.3 * LAMPORTS_PER_SOL) throw new Error("fund the payer with >= 0.3 SOL first");

  // A stand-in for the future causa_vault program id. Any program id works for deriving an off-curve PDA.
  const fakeProgramId = Keypair.generate().publicKey;
  const [vaultPda, bump] = PublicKey.findProgramAddressSync([Buffer.from("vault"), payer.publicKey.toBuffer()], fakeProgramId);
  console.log(`vault PDA ${vaultPda.toBase58()} (bump ${bump}, on-curve: ${PublicKey.isOnCurve(vaultPda.toBytes())})`);

  const global = await online.fetchGlobal();
  const feeConfig = await online.fetchFeeConfig().catch(() => null);
  console.log(`global: createV2Enabled=${global.createV2Enabled} creatorFeeBps=${global.creatorFeeBasisPoints.toString()} feeBps=${global.feeBasisPoints.toString()}`);

  // 1. create (+ initial buy) with creator = PDA
  const mint = Keypair.generate();
  const initialBuySol = new BN(0.05 * LAMPORTS_PER_SOL);
  const initialBuyTokens = getBuyTokenAmountFromSolAmount({
    global, feeConfig, mintSupply: null, bondingCurve: null, amount: initialBuySol, quoteMint: NATIVE_MINT,
  });
  const common = {
    global, mint: mint.publicKey, name: "Linkr Spike", symbol: "CSPK",
    uri: "https://causa.example/spike.json", creator: vaultPda, user: payer.publicKey,
    amount: initialBuyTokens, solAmount: initialBuySol,
  };
  const createIxs = global.createV2Enabled
    ? await sdk.createV2AndBuyInstructions({ ...common, mayhemMode: false })
    : await sdk.createAndBuyInstructions(common);
  const tokenProgram = global.createV2Enabled ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  console.log(`\n1. create${global.createV2Enabled ? "_v2" : ""} + buy ${sol(initialBuySol)} SOL, mint ${mint.publicKey.toBase58()}`);
  await send("create+buy", new Transaction().add(...createIxs), [payer, mint]);

  const curve = await online.fetchBondingCurve(mint.publicKey);
  console.log(`  bondingCurve.creator = ${curve.creator.toBase58()}  ${curve.creator.equals(vaultPda) ? "== vault PDA ✓" : "!= vault PDA ✗"}`);

  // 2. an unrelated buyer trades, creator fees accrue
  const buyer = Keypair.generate();
  await fund(payer, buyer.publicKey, 0.06 * LAMPORTS_PER_SOL);
  const state = await online.fetchBuyState(mint.publicKey, buyer.publicKey, tokenProgram);
  const buySol = new BN(0.03 * LAMPORTS_PER_SOL);
  const buyTokens = getBuyTokenAmountFromSolAmount({
    global, feeConfig, mintSupply: null, bondingCurve: state.bondingCurve, amount: buySol, quoteMint: NATIVE_MINT,
  });
  const buyIxs = await sdk.buyInstructions({
    global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
    associatedUserAccountInfo: state.associatedUserAccountInfo, mint: mint.publicKey, user: buyer.publicKey,
    amount: buyTokens, solAmount: buySol, slippage: 5, tokenProgram,
  });
  console.log(`\n2. buyer ${buyer.publicKey.toBase58().slice(0, 6)}… buys ${sol(buySol)} SOL`);
  await send("buy", new Transaction().add(...buyIxs), [buyer]);

  const cv = creatorVaultPda(vaultPda);
  const cvBalance = await connection.getBalance(cv);
  const both = await online.getCreatorVaultBalanceBothPrograms(vaultPda);
  console.log(`  creator vault ${cv.toBase58()} holds ${sol(cvBalance)} SOL (sdk both-programs: ${sol(both)} SOL)`);

  // 3. a third party sweeps the fees — nobody signs for the PDA
  const collector = Keypair.generate();
  await fund(payer, collector.publicKey, 0.02 * LAMPORTS_PER_SOL);
  const pdaBefore = await connection.getBalance(vaultPda);
  const collectIxs = await online.collectCoinCreatorFeeInstructions(vaultPda, collector.publicKey);
  console.log(`\n3. collector ${collector.publicKey.toBase58().slice(0, 6)}… sends ${collectIxs.length} collect ix(s); PDA before ${sol(pdaBefore)} SOL`);
  const signerKeys = new Set(collectIxs.flatMap((ix) => ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())));
  console.log(`  required signers: ${[...signerKeys].join(", ")}`);
  await send("collect", new Transaction().add(...collectIxs), [collector]);
  const pdaAfter = await connection.getBalance(vaultPda);
  const cvAfter = await connection.getBalance(cv);
  console.log(`  PDA after ${sol(pdaAfter)} SOL (+${sol(pdaAfter - pdaBefore)}), creator vault now ${sol(cvAfter)} SOL`);

  const ok = curve.creator.equals(vaultPda) && pdaAfter > pdaBefore && !signerKeys.has(vaultPda.toBase58());
  console.log(`\n${ok ? "PASS" : "FAIL"}: PDA-as-creator ${curve.creator.equals(vaultPda) ? "✓" : "✗"}, permissionless collect ${!signerKeys.has(vaultPda.toBase58()) ? "✓" : "✗"}, fees credited to PDA ${pdaAfter > pdaBefore ? "✓" : "✗"}`);
  console.log(`bonding curve: ${bondingCurvePda(mint.publicKey).toBase58()}  explorer: https://solscan.io/token/${mint.publicKey.toBase58()}?cluster=devnet`);
}

main().catch((e) => {
  console.error("spike failed:", e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
