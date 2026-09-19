import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import type BN from "bn.js";
import { activeCluster, PROGRAM_ID } from "../solana/cluster";
import { collections } from "../db/collections";
import type { ClaimDoc, HarvestDoc, LaunchDoc, SwapDoc, TransferStreamDoc, VaultDoc } from "../db/types";
import { decodeEvents } from "./events";

export interface IngestResult {
  launchesTouched: string[];
  vaultsCreated: string[];
  vaultsTouched: string[];
  events: number;
}

const cluster = activeCluster;
export const eventId = (signature: string, ixIndex: number, order: number) => `${signature}:${ixIndex}:${order}`;
export const launchId = (mint: string) => `${cluster}:${mint}`;
export const vaultId = (vault: string) => `${cluster}:${vault}`;
export const epochDocId = (vault: string, epochId: number | bigint) => `${cluster}:${vault}:${epochId}`;
export const leafId = (vault: string, epochId: number | bigint, account: string) => `${cluster}:${vault}:${epochId}:${account}`;
export const streamId = (mint: string) => `${cluster}:${mint}`;

const str = (v: BN | number | bigint | string) => v.toString();
const key = (v: { toBase58(): string }) => v.toBase58();
const hex32 = (v: number[] | Uint8Array) => `0x${Buffer.from(v).toString("hex")}`;

/**
 * Idempotently writes every causa_vault event of one confirmed transaction. Vault state is NOT derived from
 * event deltas (that would not be idempotent) — callers refresh touched vaults from chain afterwards.
 */
export async function ingestTransaction(tx: ParsedTransactionWithMeta, signature: string): Promise<IngestResult> {
  const c = await collections();
  const events = decodeEvents(tx);
  const result: IngestResult = { launchesTouched: [], vaultsCreated: [], vaultsTouched: [], events: events.length };
  if (events.length === 0) return result;
  const slot = tx.slot;
  const timestamp = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);
  const launchesTouched = new Set<string>();
  const vaultsTouched = new Set<string>();
  const harvestOps: HarvestDoc[] = [];
  const swapOps: SwapDoc[] = [];
  const claimOps: ClaimDoc[] = [];
  const now = new Date();

  for (const ev of events) {
    const d = ev.data;
    switch (ev.name) {
      case "VaultCreated": {
        const vault = key(d.vault);
        const mints: string[] = d.mints.map(key);
        const weights: number[] = d.weightsBps;
        const doc: VaultDoc = {
          _id: vaultId(vault),
          cluster,
          address: vault,
          programId: PROGRAM_ID.toBase58(),
          creator: key(d.creator),
          salt: str(d.salt),
          expectedMint: key(d.expectedMint),
          // token program / decimals are filled by refreshVaults from the on-chain legs
          basket: mints.map((mint, i) => ({ mint, tokenProgram: "", decimals: 0, weightBps: Number(weights[i]) })),
          epochLength: Number(d.epochLength),
          launchMint: null,
          // token program / decimals of the quote are filled by refreshVaults too
          quoteMint: key(d.quoteMint),
          quoteTokenProgram: "",
          quoteDecimals: 0,
          boundAt: null,
          status: "pending",
          lastPeriodEnd: null,
          epochCount: 0,
          unallocated: mints.map(() => "0"),
          allocated: mints.map(() => "0"),
          pendingSwap: mints.map(() => "0"),
          harvestedTotals: mints.map(() => "0"),
          creatorVaultBalance: "0",
          idleLamports: "0",
          idleQuote: "0",
          inputTotal: "0",
          protocolCutTotal: "0",
          harvestCount: 0,
          lastHarvestAt: null,
          autoClaim: false,
          createdAt: timestamp,
          createdAtSlot: slot,
          createdAtSignature: signature,
          updatedAt: now,
        };
        await c.vaults.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
        result.vaultsCreated.push(vault);
        vaultsTouched.add(vault);
        break;
      }
      case "LaunchBound": {
        const vault = key(d.vault);
        const mint = key(d.mint);
        const boundAt = new Date(Number(d.boundAt) * 1000);
        await c.vaults.updateOne(
          { _id: vaultId(vault) },
          { $set: { launchMint: mint, boundAt, status: "active", updatedAt: now } },
        );
        // the coin may not have been seen by the live feed; refreshLaunches fills the rest in
        const boundVault = await c.vaults.findOne({ _id: vaultId(vault) }, { projection: { quoteMint: 1 } });
        const launch: LaunchDoc = {
          _id: launchId(mint),
          cluster,
          mint,
          bondingCurve: key(d.bondingCurve),
          quoteMint: boundVault?.quoteMint ?? null,
          creator: vault,
          deployer: null,
          symbol: "",
          name: "",
          uri: null,
          logo: null,
          description: null,
          decimals: 6,
          complete: false,
          pool: null,
          marketCapSol: null,
          launchedAt: boundAt,
          launchedAtSlot: null,
          launchSignature: null,
          graduatedAt: null,
          source: "indexer",
          updatedAt: now,
        };
        await c.launches.updateOne({ _id: launch._id }, { $setOnInsert: launch }, { upsert: true });
        // The coin gets its own balance stream, backfilled to its first transaction so pre-bind holders count.
        const stream: TransferStreamDoc = {
          _id: streamId(mint),
          cluster,
          mint,
          vault,
          startSignature: null,
          startSlot: null,
          cursorSignature: null,
          cursorSlot: 0,
          cursorTimestamp: null,
          backfilled: false,
          backfillSignature: null,
          lastRunAt: null,
          lastError: null,
        };
        await c.transferStreams.updateOne({ _id: stream._id }, { $setOnInsert: stream }, { upsert: true });
        vaultsTouched.add(vault);
        launchesTouched.add(mint);
        break;
      }
      case "Harvested": {
        const vault = key(d.vault);
        harvestOps.push({
          _id: eventId(signature, ev.ixIndex, ev.order),
          cluster,
          vault,
          caller: key(d.caller),
          input: str(d.input),
          protocolCut: str(d.protocolCut),
          legInputs: d.legInputs.map(str),
          signature,
          slot,
          timestamp,
        });
        vaultsTouched.add(vault);
        break;
      }
      case "SwapSettled": {
        const vault = key(d.vault);
        swapOps.push({
          _id: eventId(signature, ev.ixIndex, ev.order),
          cluster,
          vault,
          leg: Number(d.leg),
          mint: key(d.mint),
          amountIn: str(d.amountIn),
          amountOut: str(d.amountOut),
          signature,
          slot,
          timestamp,
        });
        vaultsTouched.add(vault);
        break;
      }
      case "EpochPublished": {
        const vault = key(d.vault);
        const epochId = Number(d.epochId);
        const mints: string[] = d.mints.map(key);
        await c.epochs.updateOne(
          { _id: epochDocId(vault, epochId) },
          {
            $set: {
              status: "published",
              address: key(d.epoch),
              root: hex32(d.root),
              mints,
              amounts: d.amounts.map(str),
              periodStart: Number(d.periodStart),
              periodEnd: Number(d.periodEnd),
              claimableAt: Number(d.claimableAt),
              holderCount: Number(d.holderCount),
              publishedSignature: signature,
              publishedAtSlot: slot,
              updatedAt: now,
            },
            // present only when the epoch was published by someone other than our keeper
            $setOnInsert: {
              cluster,
              vault,
              epochId,
              dropped: 0,
              residue: mints.map(() => "0"),
              sumAcc: "0",
              algorithmVersion: 0,
              excluded: [],
              snapshotFromSlot: null,
              snapshotToSlot: 0,
              claimedTotals: mints.map(() => "0"),
              closedSignature: null,
              tree: null,
              createdAt: now,
            },
          },
          { upsert: true },
        );
        vaultsTouched.add(vault);
        break;
      }
      case "EpochCancelled":
      case "EpochExpired": {
        const vault = key(d.vault);
        await c.epochs.updateOne(
          { _id: epochDocId(vault, Number(d.epochId)) },
          { $set: { status: ev.name === "EpochCancelled" ? "cancelled" : "expired", closedSignature: signature, updatedAt: now } },
        );
        vaultsTouched.add(vault);
        break;
      }
      case "Claimed": {
        const vault = key(d.vault);
        const epochId = Number(d.epochId);
        const account = key(d.account);
        const epoch = await c.epochs.findOne({ _id: epochDocId(vault, epochId) }, { projection: { mints: 1 } });
        claimOps.push({
          _id: eventId(signature, ev.ixIndex, ev.order),
          cluster,
          vault,
          epochId,
          account,
          mints: epoch?.mints ?? [],
          amounts: d.amounts.map(str),
          signature,
          slot,
          timestamp,
        });
        await c.epochLeaves.updateOne(
          { _id: leafId(vault, epochId, account) },
          { $set: { claimed: true, claimedSignature: signature, claimedAt: timestamp } },
        );
        vaultsTouched.add(vault);
        break;
      }
      case "AutoClaimUpdated": {
        const vault = key(d.vault);
        await c.vaults.updateOne({ _id: vaultId(vault) }, { $set: { autoClaim: Boolean(d.enabled), updatedAt: now } });
        vaultsTouched.add(vault);
        break;
      }
      case "Rescued":
      case "ConfigUpdated":
      case "BasketMintUpdated":
        break;
    }
  }

  if (harvestOps.length) {
    await c.harvests.bulkWrite(harvestOps.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false });
  }
  if (swapOps.length) {
    await c.swaps.bulkWrite(swapOps.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false });
  }
  if (claimOps.length) {
    await c.claims.bulkWrite(claimOps.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false });
  }
  result.launchesTouched = [...launchesTouched];
  result.vaultsTouched = [...vaultsTouched];
  return result;
}
