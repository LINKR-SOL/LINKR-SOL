import type { Collection, Db } from "mongodb";
import { getDb } from "../mongo";
import {
  COLLECTIONS,
  type BalanceChangeDoc,
  type ClaimDoc,
  type EpochDoc,
  type EpochLeafDoc,
  type HarvestDoc,
  type HolderSnapshotDoc,
  type LaunchDoc,
  type LockDoc,
  type NewsDoc,
  type TradeDoc,
  type SourceRunDoc,
  type SwapDoc,
  type SyncStateDoc,
  type TelegramDraftDoc,
  type TelegramUpdateDoc,
  type TelegramUserDoc,
  type TokenDoc,
  type TransferStreamDoc,
  type VaultDoc,
} from "./types";

export interface Collections {
  db: Db;
  syncState: Collection<SyncStateDoc>;
  tokens: Collection<TokenDoc>;
  launches: Collection<LaunchDoc>;
  trades: Collection<TradeDoc>;
  vaults: Collection<VaultDoc>;
  harvests: Collection<HarvestDoc>;
  swaps: Collection<SwapDoc>;
  epochs: Collection<EpochDoc>;
  epochLeaves: Collection<EpochLeafDoc>;
  balanceChanges: Collection<BalanceChangeDoc>;
  holderSnapshots: Collection<HolderSnapshotDoc>;
  transferStreams: Collection<TransferStreamDoc>;
  claims: Collection<ClaimDoc>;
  locks: Collection<LockDoc>;
  news: Collection<NewsDoc>;
  sourceRuns: Collection<SourceRunDoc>;
  tgUsers: Collection<TelegramUserDoc>;
  tgDrafts: Collection<TelegramDraftDoc>;
  tgUpdates: Collection<TelegramUpdateDoc>;
}

export async function collections(): Promise<Collections> {
  const db = await getDb();
  return {
    db,
    syncState: db.collection<SyncStateDoc>(COLLECTIONS.syncState),
    tokens: db.collection<TokenDoc>(COLLECTIONS.tokens),
    launches: db.collection<LaunchDoc>(COLLECTIONS.launches),
    trades: db.collection<TradeDoc>(COLLECTIONS.trades),
    vaults: db.collection<VaultDoc>(COLLECTIONS.vaults),
    harvests: db.collection<HarvestDoc>(COLLECTIONS.harvests),
    swaps: db.collection<SwapDoc>(COLLECTIONS.swaps),
    epochs: db.collection<EpochDoc>(COLLECTIONS.epochs),
    epochLeaves: db.collection<EpochLeafDoc>(COLLECTIONS.epochLeaves),
    balanceChanges: db.collection<BalanceChangeDoc>(COLLECTIONS.balanceChanges),
    holderSnapshots: db.collection<HolderSnapshotDoc>(COLLECTIONS.holderSnapshots),
    transferStreams: db.collection<TransferStreamDoc>(COLLECTIONS.transferStreams),
    claims: db.collection<ClaimDoc>(COLLECTIONS.claims),
    locks: db.collection<LockDoc>(COLLECTIONS.locks),
    news: db.collection<NewsDoc>(COLLECTIONS.news),
    sourceRuns: db.collection<SourceRunDoc>(COLLECTIONS.sourceRuns),
    tgUsers: db.collection<TelegramUserDoc>(COLLECTIONS.tgUsers),
    tgDrafts: db.collection<TelegramDraftDoc>(COLLECTIONS.tgDrafts),
    tgUpdates: db.collection<TelegramUpdateDoc>(COLLECTIONS.tgUpdates),
  };
}

let indexesEnsured: Promise<void> | undefined;

/** Idempotent index creation; runs once per instance. */
export function ensureIndexes(): Promise<void> {
  if (!indexesEnsured) {
    indexesEnsured = (async () => {
      const c = await collections();
      await Promise.all([
        c.tokens.createIndex({ cluster: 1, symbol: 1 }),
        c.tokens.createIndex({ cluster: 1, kind: 1 }),
        c.launches.createIndex({ cluster: 1, creator: 1 }),
        c.launches.createIndex({ cluster: 1, deployer: 1 }),
        c.launches.createIndex({ cluster: 1, launchedAt: -1 }),
        c.launches.createIndex({ cluster: 1, quoteMint: 1 }),
        c.trades.createIndex({ mint: 1, timestamp: -1 }),
        c.trades.createIndex({ timestamp: -1 }),
        // Trades feed a live tape, not an archive.
        c.trades.createIndex({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 }),
        c.vaults.createIndex({ cluster: 1, creator: 1 }),
        c.vaults.createIndex({ cluster: 1, launchMint: 1 }),
        c.vaults.createIndex({ cluster: 1, expectedMint: 1 }),
        c.vaults.createIndex({ cluster: 1, status: 1 }),
        c.harvests.createIndex({ vault: 1, timestamp: -1 }),
        c.swaps.createIndex({ vault: 1, timestamp: -1 }),
        c.epochs.createIndex({ vault: 1, epochId: -1 }),
        c.epochs.createIndex({ cluster: 1, status: 1 }),
        c.epochLeaves.createIndex({ cluster: 1, account: 1, claimed: 1 }),
        c.epochLeaves.createIndex({ vault: 1, epochId: 1 }),
        c.epochLeaves.createIndex({ vault: 1, claimed: 1, pushAttemptAt: 1 }),
        c.balanceChanges.createIndex({ mint: 1, slot: 1, index: 1 }),
        c.balanceChanges.createIndex({ mint: 1, timestamp: 1 }),
        c.holderSnapshots.createIndex({ mint: 1, periodEnd: 1 }),
        c.claims.createIndex({ account: 1, timestamp: -1 }),
        c.claims.createIndex({ vault: 1, epochId: 1 }),
        c.locks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        c.news.createIndex({ publishedAt: -1 }),
        c.news.createIndex({ category: 1, publishedAt: -1 }),
        c.news.createIndex({ tickers: 1, publishedAt: -1 }),
        // Stories age out on their own; the wire is a live feed, not an archive.
        c.news.createIndex({ collectedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 }),
        c.sourceRuns.createIndex({ source: 1, startedAt: -1 }),
        c.sourceRuns.createIndex({ startedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }),
        c.tgDrafts.createIndex({ tgUserId: 1, status: 1, launchedAt: -1 }),
        // Telegram only retries an update for a short while; the ids are kept long enough to outlast that.
        c.tgUpdates.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 2 }),
      ]);
    })().catch((e) => {
      indexesEnsured = undefined;
      throw e;
    });
  }
  return indexesEnsured;
}
