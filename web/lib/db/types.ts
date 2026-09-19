import type { Decimal128 } from "mongodb";

/**
 * MongoDB document shapes. On-chain amounts are stored as decimal strings of raw units (never JS numbers);
 * USD values are Decimal128. `_id`s are deterministic so every write is an idempotent upsert.
 * Addresses are base58 and case-sensitive: never lower-case them.
 */

export type TokenKind = "launch" | "xstock" | "wsol" | "usdc" | "other";
export type PriceSource = "jupiter" | "gecko" | "curve" | "none";

export interface SyncStateDoc {
  _id: string; // `program:${cluster}`
  cluster: string;
  /** Newest program signature fully ingested; the walk stops when it reaches this one. */
  cursorSignature: string | null;
  cursorSlot: number;
  lastRunAt: Date | null;
  lastError: string | null;
  headSlotAtLastRun: number | null;
}

/** Token-2022 Scaled UI Amount extension state (xStocks). Raw balances never change; the multiplier is display-only. */
export interface ScaledUiState {
  multiplier: string; // decimal string of the issuer's f64
  newMultiplier: string;
  effectiveAt: number; // unix seconds the new multiplier applies from (0 = none scheduled)
  paused: boolean; // Pausable extension
  syncedAt: Date;
}

export interface TokenDoc {
  _id: string; // `${cluster}:${mint}`
  cluster: string;
  mint: string;
  tokenProgram: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: TokenKind;
  /** For xStocks: the underlying ticker (NVDAx -> NVDA), which the newswire links on. */
  underlyingSymbol: string | null;
  scaledUi: ScaledUiState | null;
  priceUsd: Decimal128 | null;
  priceSource: PriceSource;
  priceUpdatedAt: Date | null;
  logoUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A coin launched on StonkFun (Raydium LaunchLab), from the live feed, the launch flow or the indexer. */
export interface LaunchDoc {
  _id: string; // `${cluster}:${mint}`
  cluster: string;
  mint: string;
  /** The LaunchLab pool (bonding curve) account. */
  bondingCurve: string;
  /** The quote token the curve trades against (SOL, an xStock, a stablecoin…); null when not known yet. */
  quoteMint: string | null;
  /** The pool's `creator` (a LINKR vault for launches made here): who the creator fee is forwarded to. */
  creator: string;
  /** The wallet that paid for the launch (the pool's payer). */
  deployer: string | null;
  symbol: string;
  name: string;
  uri: string | null;
  logo: string | null;
  description: string | null;
  decimals: number;
  /** Curve raised its target; liquidity moved (or is moving) to the Raydium CPMM pool. */
  complete: boolean;
  /** The CPMM pool after graduation. */
  pool: string | null;
  marketCapSol: string | null;
  launchedAt: Date;
  launchedAtSlot: number | null;
  launchSignature: string | null;
  graduatedAt: Date | null;
  source: "stonkfun" | "api" | "indexer" | "launch";
  updatedAt: Date;
}

/** A curve trade from the live feed (home tape). */
export interface TradeDoc {
  _id: string; // signature
  cluster: string;
  mint: string;
  trader: string;
  side: "buy" | "sell";
  solAmount: string; // lamports
  tokenAmount: string; // raw
  marketCapSol: string | null;
  pool: string | null;
  timestamp: Date;
}

// ---------------------------------------------------------------------------------------------------------------
// Dividend vaults (fee-funded stock dividends for StonkFun launches)
// ---------------------------------------------------------------------------------------------------------------

export type VaultStatus = "pending" | "active";

export interface VaultBasketDoc {
  mint: string;
  tokenProgram: string;
  decimals: number;
  weightBps: number;
}

/** A causa_vault `Vault` PDA. Balances/epoch fields are refreshed from the account after every touching event. */
export interface VaultDoc {
  _id: string; // `${cluster}:${vault}`
  cluster: string;
  address: string;
  programId: string;
  creator: string;
  salt: string;
  expectedMint: string;
  basket: VaultBasketDoc[];
  epochLength: number; // seconds
  launchMint: string | null;
  /** What the coin trades against and what creator fees arrive in: SOL or any launchable quote token. */
  quoteMint: string;
  quoteTokenProgram: string;
  quoteDecimals: number;
  boundAt: Date | null;
  status: VaultStatus;
  lastPeriodEnd: number | null; // unix seconds
  epochCount: number;
  unallocated: string[]; // aligned with basket
  allocated: string[];
  pendingSwap: string[];
  harvestedTotals: string[];
  /** Creator fees accrued on chain in LaunchLab's creator fee vault and not yet claimed, raw quote units. */
  creatorVaultBalance: string;
  /** Lamports on the vault above its floor (SOL-quoted vaults): forwarded fees not yet harvested. */
  idleLamports: string;
  /** Quote tokens in the vault's quote token account not yet accounted for (harvestable), raw units. */
  idleQuote: string;
  inputTotal: string;
  protocolCutTotal: string;
  harvestCount: number;
  lastHarvestAt: Date | null;
  autoClaim: boolean;
  createdAt: Date;
  createdAtSlot: number;
  createdAtSignature: string;
  updatedAt: Date;
}

/** `harvest_intake`: quote in, per-leg reservations out. */
export interface HarvestDoc {
  _id: string; // `${signature}:${ixIndex}`
  cluster: string;
  vault: string;
  caller: string;
  input: string;
  protocolCut: string;
  legInputs: string[]; // aligned with basket
  signature: string;
  slot: number;
  timestamp: Date;
}

/** `swap_settle`: one leg's reserved quote converted into the stock. */
export interface SwapDoc {
  _id: string; // `${signature}:${ixIndex}`
  cluster: string;
  vault: string;
  leg: number;
  mint: string;
  amountIn: string;
  amountOut: string;
  signature: string;
  slot: number;
  timestamp: Date;
}

export type EpochStatus = "computed" | "published" | "cancelled" | "expired";

/**
 * A payout epoch. Created off-chain by the dividend keeper (status `computed`, with leaves + proofs), then
 * confirmed by the EpochPublished event.
 */
export interface EpochDoc {
  _id: string; // `${cluster}:${vault}:${epochId}`
  cluster: string;
  vault: string;
  epochId: number;
  /** The Epoch PDA, once published. */
  address: string | null;
  status: EpochStatus;
  root: string; // hex, 32 bytes
  mints: string[];
  amounts: string[]; // published per-mint totals (= sum of kept leaves)
  periodStart: number; // unix seconds
  periodEnd: number;
  claimableAt: number | null;
  holderCount: number;
  dropped: number; // dust holders excluded from the tree
  residue: string[]; // per-mint flooring residue left unallocated
  sumAcc: string; // total balance-seconds of included holders
  algorithmVersion: number;
  excluded: string[];
  snapshotFromSlot: number | null;
  snapshotToSlot: number;
  claimedTotals: string[];
  publishedSignature: string | null;
  publishedAtSlot: number | null;
  closedSignature: string | null; // cancel / expire
  tree: unknown | null; // serialised tree for audit
  createdAt: Date;
  updatedAt: Date;
}

export interface EpochLeafDoc {
  _id: string; // `${cluster}:${vault}:${epochId}:${account}`
  cluster: string;
  vault: string;
  epochId: number;
  account: string;
  amounts: string[];
  proof: string[]; // hex nodes
  acc: string; // holder's balance-seconds
  claimed: boolean;
  claimedSignature: string | null;
  claimedAt: Date | null;
  /** keeper auto-delivery bookkeeping (null until the keeper tried) */
  pushAttemptAt?: Date | null;
  /** basket legs already sent for this leaf, when a delivery is split across transactions */
  sentLegs?: number[];
  pushSignature?: string | null;
  pushError?: string | null;
  /** custodial mode: the holder pressed Claim, deliver regardless of the auto-delivery policy */
  deliverRequestedAt?: Date | null;
}

/**
 * One holder's balance change of a bound launch mint, aggregated per (transaction, owner) from pre/post token
 * balances. `delta` is signed. Ordering for the TWAB replay is (slot, index).
 */
export interface BalanceChangeDoc {
  _id: string; // `${signature}:${owner}`
  cluster: string;
  mint: string;
  owner: string;
  delta: string;
  slot: number;
  /** position of the transaction within its slot, as ordered by getSignaturesForAddress */
  index: number;
  signature: string;
  timestamp: number; // unix seconds (numbers, not Dates: the TWAB math wants integers)
}

/** Balance of one holder at the end of an epoch period (zero balances are not stored). */
export interface HolderSnapshotDoc {
  _id: string; // `${cluster}:${mint}:${periodEnd}:${owner}`
  cluster: string;
  mint: string;
  periodEnd: number;
  owner: string;
  balance: string;
  asOfSlot: number;
}

export interface TransferStreamDoc {
  _id: string; // `${cluster}:${mint}`
  cluster: string;
  mint: string;
  vault: string;
  /** The launch signature: backfill walks back to it and stops. */
  startSignature: string | null;
  startSlot: number | null;
  /** Newest signature ingested (forward cursor). */
  cursorSignature: string | null;
  cursorSlot: number;
  /** Balances are known complete up to this unix time: the chain head at the last empty walk, or the newest signature. */
  cursorTimestamp: number | null;
  /** True once the walk back from head reached `startSignature`. */
  backfilled: boolean;
  /** Oldest signature ingested during backfill (moves backwards until `backfilled`). */
  backfillSignature: string | null;
  lastRunAt: Date | null;
  lastError: string | null;
}

export interface ClaimDoc {
  _id: string; // `${signature}:${ixIndex}`
  cluster: string;
  vault: string;
  epochId: number;
  account: string;
  mints: string[];
  amounts: string[];
  signature: string;
  slot: number;
  timestamp: Date;
}

/**
 * A story on the newswire. `_id` is the headline fingerprint, so the same story arriving
 * from an aggregator and from its publisher upserts into one row instead of two.
 */
export interface NewsDoc {
  _id: string;
  title: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  source: { key: string; name: string; domain: string | null };
  publishedAt: Date;
  collectedAt: Date;
  /** Bucket the UI filters on. */
  category: "markets" | "stocks" | "crypto" | "chain" | "protocol" | "company";
  /** Underlying tickers (NVDA, TSLA, …) of the xStocks the story resolves to. */
  tickers: string[];
  narratives: string[];
  lane: "market" | "chain" | "macro" | "culture";
  tier: number;
  /** Structured markers from the source: halt, filing, macro_release. */
  signals: Record<string, string | number | boolean>;
  /** Ranking input: recency, source tier and linkage strength. */
  score: number;
  /** Optional AI reading of the story. Never a gate — see SOURCE_INVENTORY.md §6. */
  insight: string | null;
  sentiment: "bullish" | "bearish" | "neutral" | null;
  tags: string[];
  enrichedAt: Date | null;
}

/** One source's run: availability and latency monitoring, per SOURCE_INVENTORY.md §7. */
export interface SourceRunDoc {
  _id: string; // `${source}:${startedAt.toISOString()}`
  source: string;
  lane: string;
  startedAt: Date;
  latencyMs: number;
  items: number;
  kept: number;
  error: string | null;
}

/** Short-lived lease so two keeper runs never send transactions concurrently. */
export interface LockDoc {
  _id: string;
  owner: string;
  expiresAt: Date;
}

/* ---------------------------------------------------------------- Telegram bot */

/** A Telegram user of the launch bot, and the bot wallet derived for them (see lib/telegram/wallets.ts). */
export interface TelegramUserDoc {
  _id: string; // `${cluster}:${tgUserId}`
  cluster: string;
  tgUserId: number;
  chatId: number;
  username: string | null;
  firstName: string | null;
  /** base58 public key of the bot wallet; the secret is derived, never stored */
  wallet: string;
  /** the draft this user is working on, if any */
  draftId: string | null;
  /** what the next plain-text message answers when it is not a draft step */
  awaiting: "withdraw" | null;
  /** a withdrawal waiting for its confirm button */
  pendingWithdraw: { lamports: string; to: string; at: Date } | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type TelegramDraftStep = "name" | "symbol" | "logo" | "description" | "socials" | "quote" | "basket" | "period" | "buy" | "review";
export type TelegramDraftStatus = "editing" | "launching" | "launched" | "failed" | "cancelled";

/**
 * A launch being assembled in Telegram: the same fields as the web wizard, filled one chat step at a time. Signed
 * either by the bot wallet (the bot runs both transactions) or in the user's own wallet (the wizard opens with
 * `?draft=<id>` prefilled). `rev` makes every write conditional on the version it was computed from.
 */
export interface TelegramDraftDoc {
  _id: string; // random, url-safe; also the `?draft=` id
  cluster: string;
  tgUserId: number;
  chatId: number;
  status: TelegramDraftStatus;
  step: TelegramDraftStep;
  /** set while one field is changed from the review: the answer goes straight back to the review */
  editing: boolean;
  rev: number;
  name: string | null;
  symbol: string | null;
  logo: string | null;
  /** Telegram's file id for the logo once it has been sent as a photo, so cards reuse it instead of re-uploading */
  logoFileId?: string | null;
  description: string | null;
  socials: { twitter?: string; telegram?: string; website?: string };
  quote: { mint: string; symbol: string; decimals: number; tokenProgram: string } | null;
  basket: { mint: string; symbol: string; tokenProgram: string; weight: number }[];
  /** basket step: the stock (mint) whose % the next typed number sets */
  weightFor?: string | null;
  /** links step: the link the next message sets */
  socialFor?: "twitter" | "telegram" | "website" | null;
  epochLength: number | null;
  /** whole quote units, as typed */
  initialBuy: string | null;
  /** who signs: the bot wallet, or the user's own wallet on the site */
  signer: "bot" | "wallet" | null;
  /** bot launches: the vault's salt, kept so a retry reuses the same vault */
  salt: string | null;
  vault: string | null;
  mint: string | null;
  prepareSignature: string | null;
  launchSignature: string | null;
  /** the chat message a bot launch edits as it progresses */
  progressMessageId: number | null;
  error: string | null;
  launchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Telegram retries a webhook it did not get a 200 for; each update is handled once. */
export interface TelegramUpdateDoc {
  _id: string; // `${cluster}:${update_id}`
  at: Date;
}

export const COLLECTIONS = {
  syncState: "sync_state",
  tokens: "tokens",
  launches: "launches",
  trades: "trades",
  vaults: "vaults",
  harvests: "harvests",
  swaps: "swaps",
  epochs: "epochs",
  epochLeaves: "epoch_leaves",
  balanceChanges: "balance_changes",
  holderSnapshots: "holder_snapshots",
  transferStreams: "transfer_streams",
  claims: "claims",
  locks: "locks",
  news: "news",
  sourceRuns: "source_runs",
  tgUsers: "tg_users",
  tgDrafts: "tg_drafts",
  tgUpdates: "tg_updates",
} as const;
