/**
 * Devnet only: registers LINKR's own LaunchLab platform so launches can be attributed to it the way StonkFun's
 * are on mainnet. StonkFun's platform pays the creator off-chain; this one uses LaunchLab's on-chain creator fee
 * (0.5% of every trade, next to a 0.5% platform fee — the same 1% a StonkFun standard launch pays), so the
 * keeper's claim path gets exercised for real.
 *
 * Run from web/:  npx tsx scripts/launchlab-devnet-platform.ts
 * Needs KEEPER_PRIVATE_KEY (the platform admin, ~0.02 SOL). Prints the LAUNCHLAB_PLATFORM_ID to put in .env.local.
 */
import fs from "node:fs";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const [{ activeCluster, isMainnet }, { serverConnection }, { keeperKeypair }, { sendKeeperTx }, { LAUNCHLAB_PROGRAM_ID, CPMM_PROGRAM_ID }, { fetchPlatform }, sdk] = await Promise.all([
    import("../lib/solana/cluster"),
    import("../lib/solana/connection"),
    import("../lib/solana/keeper"),
    import("../lib/solana/send"),
    import("../lib/launchlab/ids"),
    import("../lib/launchlab/pool"),
    import("@raydium-io/raydium-sdk-v2"),
  ]);
  if (isMainnet) throw new Error("this script is for devnet; on mainnet launches use StonkFun's platform");
  const keeper = keeperKeypair();
  if (!keeper) throw new Error("KEEPER_PRIVATE_KEY not set");
  const connection = serverConnection();
  console.log(`cluster ${activeCluster} · admin ${keeper.publicKey.toBase58()} · ${(await connection.getBalance(keeper.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  const platformId = sdk.getPdaPlatformId(LAUNCHLAB_PROGRAM_ID, keeper.publicKey).publicKey;
  const existing = await fetchPlatform(connection, platformId);
  if (existing) {
    console.log(`platform already exists: ${existing.name} feeRate=${existing.feeRate} creatorFeeRate=${existing.creatorFeeRate}`);
    console.log(`LAUNCHLAB_PLATFORM_ID=${platformId.toBase58()}`);
    return;
  }
  const cpConfigId = sdk.getCpmmPdaAmmConfigId(CPMM_PROGRAM_ID, 0).publicKey;
  const ix = sdk.createPlatformConfig(
    LAUNCHLAB_PROGRAM_ID,
    keeper.publicKey,
    keeper.publicKey,
    keeper.publicKey,
    keeper.publicKey,
    platformId,
    cpConfigId,
    keeper.publicKey,
    { platformScale: new BN(1_000_000), creatorScale: new BN(0), burnScale: new BN(0) },
    new BN(5_000), // platform: 0.5% of every trade
    new BN(5_000), // creator: 0.5% of every trade, claimable on chain by the creator (the vault)
    "LINKR devnet",
    "https://causa.rh",
    "",
    new BN(0),
  );
  const { signature } = await sendKeeperTx(connection, keeper, [ix], { computeUnits: 200_000 });
  console.log(`created platform ${platformId.toBase58()} in ${signature}`);
  console.log(`LAUNCHLAB_PLATFORM_ID=${platformId.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
