/**
 * One-time mainnet setup, run by the admin keypair after `anchor deploy`:
 *   1. init_config (operator = keeper, protocol share, review/claim windows, min period)
 *   2. allow_basket_mint for the xStocks in ALLOWLIST (looked up in the Backed registry snapshot)
 * Idempotent: skips what already exists, so it is safe to re-run to extend the allowlist.
 *
 *   ADMIN_KEYPAIR=~/.config/solana/causa-mainnet-admin.json \
 *   KEEPER_PUBKEY=<keeper pubkey> PROTOCOL_RECIPIENT=<pubkey> \
 *   npx tsx scripts/mainnet-setup.ts [NVDA,TSLA,AAPL,...]
 *
 * Reads .env.local for the RPC (NEXT_PUBLIC_SOLANA_CLUSTER must be mainnet-beta) and the program id.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const DEFAULT_ALLOWLIST = ["NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "SPY", "QQQ", "COIN", "HOOD", "MSTR", "CRCL"];

/** Production defaults: a 10-minute review window, 180-day claim window, 1-hour minimum period, 5% protocol share. */
const CONFIG = { protocolShareBps: 500, disputeWindow: 600, claimWindow: 180 * 86_400, minEpochLength: 3_600 };

async function main() {
  const [{ activeCluster, publicRpcUrl, PROGRAM_ID }, { walletProgram, configPda, basketPda }, { KeypairWallet }, { EVENT_AUTHORITY }, { sendKeeperTx }, { MAINNET_STOCK_TOKENS }] = await Promise.all([
    import("../lib/solana/cluster"), import("../lib/solana/program"), import("../lib/solana/keeper"), import("../lib/solana/ix"), import("../lib/solana/send"), import("../lib/stock-tokens.generated"),
  ]);
  if (activeCluster !== "mainnet-beta") throw new Error(`NEXT_PUBLIC_SOLANA_CLUSTER is ${activeCluster}; this script is for mainnet-beta`);
  const keyPath = (process.env.ADMIN_KEYPAIR ?? "~/.config/solana/causa-mainnet-admin.json").replace(/^~/, os.homedir());
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(keyPath), "utf8"))));
  const keeper = new PublicKey(process.env.KEEPER_PUBKEY ?? "");
  const recipient = new PublicKey(process.env.PROTOCOL_RECIPIENT ?? admin.publicKey.toBase58());
  const symbols = (process.argv[2] ?? DEFAULT_ALLOWLIST.join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  const connection = new Connection(publicRpcUrl, "confirmed");
  const program = walletProgram(connection, new KeypairWallet(admin));
  console.log(`program ${PROGRAM_ID.toBase58()} · admin ${admin.publicKey.toBase58()} · keeper ${keeper.toBase58()} · recipient ${recipient.toBase58()}`);
  console.log(`admin balance ${(await connection.getBalance(admin.publicKey)) / 1e9} SOL`);

  const config = configPda();
  const existing = await program.account.config.fetchNullable(config);
  if (existing) {
    console.log(`config exists (operator ${existing.operator.toBase58()}, dispute ${existing.disputeWindow}s, min period ${existing.minEpochLength}s) — skipping init`);
  } else {
    const ix = await program.methods
      .initConfig({ operator: keeper, protocolRecipient: recipient, ...CONFIG })
      .accountsStrict({ admin: admin.publicKey, config, systemProgram: SystemProgram.programId, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
      .instruction();
    const { signature } = await sendKeeperTx(connection, admin, [ix]);
    console.log(`init_config ${signature}`);
  }

  const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  for (const symbol of symbols) {
    const stock = MAINNET_STOCK_TOKENS.find((t) => t.symbol === symbol || t.xSymbol === symbol);
    if (!stock) {
      console.log(`  ${symbol}: not in the xStocks registry, skipped`);
      continue;
    }
    const mint = new PublicKey(stock.mint);
    if (await program.account.allowedBasketMint.fetchNullable(basketPda(mint))) {
      console.log(`  ${stock.xSymbol}: already allowed`);
      continue;
    }
    const info = await connection.getAccountInfo(mint);
    if (!info) {
      console.log(`  ${stock.xSymbol}: mint ${stock.mint} not found on chain, skipped`);
      continue;
    }
    const tokenProgram = info.owner.equals(TOKEN_2022) ? TOKEN_2022 : info.owner;
    const ix = await program.methods
      .allowBasketMint()
      .accountsStrict({ admin: admin.publicKey, config, mint, tokenProgram, basket: basketPda(mint), systemProgram: SystemProgram.programId, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
      .instruction();
    const { signature } = await sendKeeperTx(connection, admin, [ix]);
    console.log(`  ${stock.xSymbol}: allowed ${signature}`);
  }
  console.log("done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
