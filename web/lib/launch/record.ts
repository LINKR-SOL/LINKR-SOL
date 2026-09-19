import { PublicKey } from "@solana/web3.js";
import { activeCluster } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { isBase58Address } from "../solana/address";
import { fetchLaunchpadPoolFor, launchpadPoolId } from "../launchlab/pool";
import { SOL_PAIR } from "../launchlab/pairs";
import { collections } from "../db/collections";
import type { LaunchDoc } from "../db/types";
import { launchToJson } from "../api/launches";
import { refreshLaunches } from "../indexer/refresh";
import type { LaunchJson } from "../api-types";
import { LaunchInputError } from "./errors";

export interface RecordLaunchInput {
  mint?: string;
  quoteMint?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  logo?: string;
  description?: string;
  deployer?: string;
  signature?: string;
}

/**
 * Registers a coin that was just created, so the vault page shows it before the keeper binds it. Only accepted
 * when the LaunchLab pool exists on chain (the mint and quote are verified, nothing is trusted from the body).
 * Returns the stored launch and the pool's on-chain creator (the vault, for a LINKR launch).
 */
export async function recordLaunch(body: RecordLaunchInput): Promise<{ launch: LaunchJson; creator: string }> {
  if (!body.mint || !isBase58Address(body.mint)) throw new LaunchInputError("mint required");
  const quoteMint = body.quoteMint ?? SOL_PAIR.mint;
  if (!isBase58Address(quoteMint)) throw new LaunchInputError("invalid quote mint");
  const mint = new PublicKey(body.mint);
  const quote = new PublicKey(quoteMint);
  const pool = await fetchLaunchpadPoolFor(serverConnection(), mint, quote).catch(() => null);
  if (!pool) throw new LaunchInputError("launch pool not found on chain yet", 404);
  const c = await collections();
  const now = new Date();
  const doc: LaunchDoc = {
    _id: `${activeCluster}:${body.mint}`,
    cluster: activeCluster,
    mint: body.mint,
    bondingCurve: launchpadPoolId(mint, quote).toBase58(),
    quoteMint,
    creator: pool.creator,
    deployer: body.deployer && isBase58Address(body.deployer) ? body.deployer : null,
    symbol: (body.symbol ?? "").slice(0, 13),
    name: (body.name ?? "").slice(0, 32),
    uri: body.uri?.slice(0, 200) ?? null,
    logo: body.logo?.slice(0, 500) ?? null,
    description: body.description?.slice(0, 1000) ?? null,
    decimals: pool.mintDecimalsA,
    complete: pool.status !== 0,
    pool: null,
    marketCapSol: null,
    launchedAt: now,
    launchedAtSlot: null,
    launchSignature: body.signature ?? null,
    graduatedAt: null,
    source: "launch",
    updatedAt: now,
  };
  await c.launches.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  await refreshLaunches([body.mint]).catch(() => {});
  const saved = await c.launches.findOne({ _id: doc._id });
  return { launch: saved ? launchToJson(saved) : launchToJson(doc), creator: pool.creator };
}
