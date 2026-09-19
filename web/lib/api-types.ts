/** JSON shapes returned by /api/* (all on-chain amounts are decimal strings of raw units; addresses are base58). */

export interface TokenJson {
  mint: string;
  tokenProgram: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: "launch" | "xstock" | "wsol" | "usdc" | "other";
  /** For xStocks: the underlying ticker (NVDAx -> NVDA). */
  underlyingSymbol: string | null;
  priceUsd: string | null;
  priceSource: "jupiter" | "gecko" | "curve" | "none";
  /** Token-2022 Scaled UI Amount state (xStocks); null for plain tokens. */
  scaledUi: {
    multiplier: string;
    newMultiplier: string;
    effectiveAt: number;
    paused: boolean;
  } | null;
  isVerified: boolean;
  logoUrl: string | null;
}

export interface LaunchJson {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  description: string | null;
  decimals: number;
  /** The pool's `creator` (a LINKR vault for launches made here). */
  creator: string;
  deployer: string | null;
  /** The LaunchLab pool (bonding curve) account. */
  bondingCurve: string;
  /** The quote token the curve trades against; null when not known yet. */
  quoteMint: string | null;
  /** Curve raised its target and liquidity moved to the Raydium CPMM pool. */
  complete: boolean;
  pool: string | null;
  marketCapSol: string | null;
  /** Raw quote units the curve has taken in so far; null once graduated. */
  solRaised: string | null;
  launchedAt: string;
  graduatedAt: string | null;
  launchSignature: string | null;
  /** The coin's page on the venue (StonkFun on mainnet). */
  url: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Dividend vaults
// ---------------------------------------------------------------------------------------------------------------

export interface VaultBasketJson extends TokenJson {
  weightBps: number;
  unallocated: string; // harvested, waiting for the next epoch
  allocated: string; // in open epochs, not yet claimed
  pendingSwap: string; // quote reserved for this leg, not swapped yet
  harvestedTotal: string;
}

export interface VaultJson {
  address: string;
  creator: string;
  salt: string;
  expectedMint: string;
  status: "pending" | "active";
  basket: VaultBasketJson[];
  epochLength: number;
  launchMint: string | null;
  quote: TokenJson;
  boundAt: string | null;
  lastPeriodEnd: number | null;
  nextEpochAt: number | null;
  epochCount: number;
  /** Creator fees accrued in LaunchLab's creator fee vault, not yet claimed (raw quote units). */
  creatorVaultBalance: string;
  /** Forwarded to the vault but not yet harvested: SOL above the floor, or unaccounted quote tokens (raw units). */
  idleQuote: string;
  inputTotal: string;
  protocolCutTotal: string;
  harvestCount: number;
  lastHarvestAt: string | null;
  autoClaim: boolean;
  createdAt: string;
  createdAtSignature: string;
  launch: LaunchJson | null;
  /**
   * A coin whose creator is this vault but that has not been bound yet. The keeper binds it within a
   * couple of minutes; until then the vault still reads as "pending", and without this the UI would invite
   * the creator to launch a second time.
   */
  pendingLaunch: LaunchJson | null;
}

export interface EpochJson {
  vault: string;
  epochId: number;
  address: string | null;
  status: "computed" | "published" | "cancelled" | "expired";
  root: string;
  tokens: TokenJson[];
  amounts: string[];
  claimedTotals: string[];
  periodStart: number;
  periodEnd: number;
  claimableAt: number | null;
  holderCount: number;
  dropped: number;
  residue: string[];
  sumAcc: string;
  algorithmVersion: number;
  excluded: string[];
  snapshotFromSlot: number | null;
  snapshotToSlot: number;
  publishedSignature: string | null;
  closedSignature: string | null;
  createdAt: string;
}

/** One fee conversion: quote-token fees in, stocks out. The receipt that a vault is actually working. */
export interface HarvestJson {
  signature: string;
  timestamp: string;
  caller: string;
  quote: TokenJson;
  input: string;
  protocolCut: string;
  legs: { token: TokenJson; amountIn: string; amountOut: string | null; swapSignature: string | null }[];
}

export interface EpochLeafJson {
  account: string;
  amounts: string[];
  proof: string[];
  acc: string;
  sharePpm: number; // acc / sumAcc in parts per million
  claimed: boolean;
  claimedSignature: string | null;
}

export interface ClaimableEpochJson {
  epochId: number;
  address: string | null;
  status: "published" | "computed";
  claimableAt: number | null;
  /** the period the payout covers, and when it was computed (published moments later) — for the payout timeline */
  periodStart: number;
  periodEnd: number;
  createdAt: string;
  amounts: string[];
  proof: string[];
  tokens: TokenJson[];
}

export interface ClaimableVaultJson {
  vault: VaultJson;
  epochs: ClaimableEpochJson[];
}

/** Estimated share of the payout that is still accruing, for a holder who keeps holding. */
export interface ProjectionJson {
  vault: VaultJson;
  /** the account's launch-token balance, read live */
  balance: string;
  /** projected share of the next epoch, parts per million */
  sharePpm: number;
  holderCount: number;
  periodStart: number;
  periodEnd: number;
  /** how far the balance stream is indexed (unix seconds) */
  asOf: number;
  /** projected amount per basket token, aligned to `vault.basket` */
  amounts: string[];
  usd: number | null;
  isEstimate: true;
  /** on-chain review window (seconds) between a payout being published and becoming claimable */
  disputeWindow: number;
  /** how long the keeper typically needs after a close to publish (seconds) */
  keeperLag: number;
  /** when the next payout is expected to become claimable: periodEnd + keeperLag + disputeWindow */
  claimableEstimate: number;
  /** nothing harvested since the last payout: a close right now would pay nothing and roll forward */
  potEmpty: boolean;
}

export interface ClaimsJson {
  account: string;
  vaults: ClaimableVaultJson[];
  /** vaults whose next payout is still accruing; empty until the coin is bound and indexed */
  projections: ProjectionJson[];
  history: { vault: string; epochId: number; tokens: TokenJson[]; amounts: string[]; signature: string; timestamp: string }[];
}

/** What a wallet needs to hold before it can launch (lamports). */
export interface LaunchCostLeg {
  required: string;
  spend: string;
  headroom: string;
}

export interface LaunchCostJson {
  lamportsPerSignature: string;
  /** Rent for the vault PDA + its token accounts; refunded only if those accounts are ever closed. */
  vaultRent: string;
  /** Rent for the accounts a LaunchLab create initialises (mint, metadata, pool, two vaults); there is no platform fee. */
  createCost: string;
  solUsd: number | null;
  /** creating the vault and launching: what a first-time creator pays */
  withVault: LaunchCostLeg;
  /** the vault already exists, only the launch is left */
  launchOnly: LaunchCostLeg;
}

export interface HarvestQuoteJson {
  quote: TokenJson;
  available: string; // creator fee vault + idle, raw quote units
  gross: string; // what this harvest will convert (<= available when the venue is thin)
  protocolCut: string;
  net: string;
  slippageBps: number;
  legs: { token: TokenJson; amountIn: string; quote: string; minOut: string; swap: boolean }[];
  minOuts: string[];
}

export interface VaultConfigJson {
  programId: string;
  cluster: string;
  admin: string;
  operator: string;
  protocolShareBps: number;
  protocolRecipient: string;
  disputeWindow: number;
  claimWindow: number;
  minEpochLength: number;
  paused: boolean;
  basketTokens: TokenJson[]; // allowlisted mints a creator may put in a basket
  /** operator-side auto-delivery policy (the creator's per-vault switch lives on chain) */
  autoClaim: { enabled: boolean; minUsd: number; delaySeconds: number; retrySeconds: number; maxPerRun: number };
}
