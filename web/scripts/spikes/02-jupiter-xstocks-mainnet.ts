/**
 * Spike 2 — Jupiter → xStocks on mainnet, the keeper's swap leg.
 *
 * Phase A (no funds): quote SOL→NVDAx, build the swap instructions with the vault's Token-2022 ATA as the
 * destination, wrap them with swap_begin/swap_settle the way the keeper does, and report transaction size
 * and lookup-table count. Phase B (needs a funded mainnet keeper + a real vault): the keeper's actual run.
 *
 *   npx tsx scripts/spikes/02-jupiter-xstocks-mainnet.ts [amountSol=0.01] [symbol=NVDA]
 */
import fs from "node:fs";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
// this spike is mainnet by definition, whatever the app is configured for
process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "mainnet-beta";

const WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

async function main() {
  const amountSol = Number(process.argv[2] ?? "0.01");
  const symbol = (process.argv[3] ?? "NVDA").toUpperCase();
  const [{ MAINNET_STOCK_TOKENS }, jup, { ata }] = await Promise.all([import("../../lib/stock-tokens.generated"), import("../../lib/jupiter/client"), import("../../lib/solana/program")]);
  const stock = MAINNET_STOCK_TOKENS.find((t) => t.symbol === symbol || t.xSymbol === symbol);
  if (!stock) throw new Error(`${symbol} not in the xStocks registry`);
  const rpc = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const mint = new PublicKey(stock.mint);
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) throw new Error("mint not found on mainnet");
  console.log(`${stock.xSymbol} ${stock.mint} · owner ${mintInfo.owner.equals(TOKEN_2022) ? "Token-2022" : mintInfo.owner.toBase58()} · ${mintInfo.data.length} bytes`);

  // A stand-in for the vault PDA: any address works for building; only Phase B needs the real one.
  const vault = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const destination = ata(vault, mint, TOKEN_2022);

  const amount = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
  const t0 = Date.now();
  const q = await jup.quote({ inputMint: WSOL, outputMint: stock.mint, amount, slippageBps: 100 });
  console.log(`quote: ${amountSol} SOL → ${q.outAmount} raw ${stock.xSymbol} (${(Number(q.outAmount) / 1e8).toFixed(6)} shares) · impact ${q.priceImpactPct}% · route ${(q.routePlan as { swapInfo: { label: string } }[]).map((r) => r.swapInfo.label).join(" > ")} · ${Date.now() - t0}ms`);

  const sw = await jup.swapInstructions(connection, q, { userPublicKey: user, destinationTokenAccount: destination });
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...sw.instructions];
  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(sw.lookupTables);
  const tx = new VersionedTransaction(msg);
  const size = tx.serialize().length;
  // swap_begin + swap_settle add ~2 × (8 + 8 accounts) ≈ 300 bytes before ALT compression; report headroom
  console.log(`swap tx: ${sw.instructions.length} instructions · ${sw.lookupTables.length} lookup tables · ${size} bytes (limit 1232, keeper adds swap_begin/settle ≈ +120 bytes with ALTs)`);
  if (size > 1_100) console.log("WARN: little headroom; the keeper may need to drop the setup instructions into a separate transaction");
  console.log(`PASS phase A${process.env.KEEPER_PRIVATE_KEY ? "" : " (phase B needs KEEPER_PRIVATE_KEY + a funded mainnet vault)"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
