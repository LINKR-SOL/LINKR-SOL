import { PublicKey, type Connection } from "@solana/web3.js";
import {
  LaunchpadConfig,
  LaunchpadPool,
  PlatformConfig,
  getPdaCreatorFeeVaultAuth,
  getPdaCreatorVault,
  getPdaLaunchpadAuth,
  getPdaLaunchpadConfigId,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformVault,
} from "@raydium-io/raydium-sdk-v2";
import { LAUNCHLAB_PROGRAM_ID } from "./ids";

/**
 * Read side of LaunchLab: PDAs and decoded account state. Everything the app needs to know about a pool is in
 * its account — who created it (the binding proof), how far it is along the curve, and what it trades against.
 */

const P = LAUNCHLAB_PROGRAM_ID;

export const launchpadAuth = () => getPdaLaunchpadAuth(P).publicKey;
export const launchpadPoolId = (mintA: PublicKey, mintB: PublicKey) => getPdaLaunchpadPoolId(P, mintA, mintB).publicKey;
export const launchpadVaultId = (poolId: PublicKey, mint: PublicKey) => getPdaLaunchpadVaultId(P, poolId, mint).publicKey;
export const launchpadConfigId = (mintB: PublicKey, curveType = 0, index = 0) => getPdaLaunchpadConfigId(P, mintB, curveType, index).publicKey;
/** Token account (of the quote) where the program accrues the on-chain creator fee for `creator`. */
export const creatorFeeVault = (creator: PublicKey, mintB: PublicKey) => getPdaCreatorVault(P, creator, mintB).publicKey;
export const creatorFeeVaultAuth = () => getPdaCreatorFeeVaultAuth(P).publicKey;
export const platformFeeVault = (platformId: PublicKey, mintB: PublicKey) => getPdaPlatformVault(P, platformId, mintB).publicKey;

/** Pool status: 0 trading on the curve, 1 raise complete and waiting to migrate, 2 migrated to the CPMM pool. */
export type PoolStatus = 0 | 1 | 2;

export interface LaunchpadPoolState {
  address: string;
  status: PoolStatus;
  creator: string;
  mintA: string;
  mintB: string;
  vaultA: string;
  vaultB: string;
  configId: string;
  platformId: string;
  mintDecimalsA: number;
  mintDecimalsB: number;
  supply: bigint;
  totalSellA: bigint;
  virtualA: bigint;
  virtualB: bigint;
  realA: bigint;
  realB: bigint;
  totalFundRaisingB: bigint;
  /** 0 = the base mint is classic SPL, 1 = Token-2022 */
  mintProgramFlag: number;
  epoch: bigint;
}

const big = (x: { toString(): string }) => BigInt(x.toString());

export function decodeLaunchpadPool(address: PublicKey, data: Buffer): LaunchpadPoolState {
  const d = LaunchpadPool.decode(data);
  return {
    address: address.toBase58(),
    status: d.status as PoolStatus,
    creator: d.creator.toBase58(),
    mintA: d.mintA.toBase58(),
    mintB: d.mintB.toBase58(),
    vaultA: d.vaultA.toBase58(),
    vaultB: d.vaultB.toBase58(),
    configId: d.configId.toBase58(),
    platformId: d.platformId.toBase58(),
    mintDecimalsA: d.mintDecimalsA,
    mintDecimalsB: d.mintDecimalsB,
    supply: big(d.supply),
    totalSellA: big(d.totalSellA),
    virtualA: big(d.virtualA),
    virtualB: big(d.virtualB),
    realA: big(d.realA),
    realB: big(d.realB),
    totalFundRaisingB: big(d.totalFundRaisingB),
    mintProgramFlag: d.mintProgramFlag,
    epoch: big(d.epoch),
  };
}

export async function fetchLaunchpadPool(connection: Connection, poolId: PublicKey): Promise<LaunchpadPoolState | null> {
  const info = await connection.getAccountInfo(poolId, "confirmed");
  if (!info || !info.owner.equals(P) || info.data.length < LaunchpadPool.span) return null;
  return decodeLaunchpadPool(poolId, info.data);
}

/** The pool of `mint` quoted against `quote`, if it exists. */
export function fetchLaunchpadPoolFor(connection: Connection, mint: PublicKey, quote: PublicKey): Promise<LaunchpadPoolState | null> {
  return fetchLaunchpadPool(connection, launchpadPoolId(mint, quote));
}

export interface LaunchpadConfigState {
  address: string;
  mintB: string;
  curveType: number;
  index: number;
  /** curve fee charged to every trade, 1e6 = 100% */
  tradeFeeRate: bigint;
  minFundRaisingB: bigint;
  minSupplyA: bigint;
  minSellRateA: bigint;
  minMigrateRateA: bigint;
  maxLockRate: bigint;
}

export async function fetchLaunchpadConfig(connection: Connection, configId: PublicKey): Promise<LaunchpadConfigState | null> {
  const info = await connection.getAccountInfo(configId, "confirmed");
  if (!info || !info.owner.equals(P) || info.data.length < LaunchpadConfig.span) return null;
  const d = LaunchpadConfig.decode(info.data);
  return {
    address: configId.toBase58(),
    mintB: d.mintB.toBase58(),
    curveType: d.curveType,
    index: d.index,
    tradeFeeRate: big(d.tradeFeeRate),
    minFundRaisingB: big(d.minFundRaisingB),
    minSupplyA: big(d.minSupplyA),
    minSellRateA: big(d.minSellRateA),
    minMigrateRateA: big(d.minMigrateRateA),
    maxLockRate: big(d.maxLockRate),
  };
}

export interface PlatformState {
  address: string;
  name: string;
  /** platform's cut of every trade, 1e6 = 100% */
  feeRate: bigint;
  /** creator's on-chain cut of every trade, 1e6 = 100% (StonkFun sets 0 and forwards off-chain instead) */
  creatorFeeRate: bigint;
  claimFeeWallet: string;
  cpConfigId: string;
}

export async function fetchPlatform(connection: Connection, platformId: PublicKey): Promise<PlatformState | null> {
  const info = await connection.getAccountInfo(platformId, "confirmed");
  if (!info || !info.owner.equals(P) || info.data.length < PlatformConfig.span) return null;
  const d = PlatformConfig.decode(info.data);
  return {
    address: platformId.toBase58(),
    name: Buffer.from(d.name as unknown as Uint8Array).toString("utf8").replace(/\0+$/, ""),
    feeRate: big(d.feeRate),
    creatorFeeRate: big(d.creatorFeeRate),
    claimFeeWallet: d.platformClaimFeeWallet.toBase58(),
    cpConfigId: d.cpConfigId.toBase58(),
  };
}

/** 0–100 progress toward graduation: how much of the raise the curve has taken in. */
export function graduationProgress(p: Pick<LaunchpadPoolState, "status" | "realB" | "totalFundRaisingB">): number {
  if (p.status !== 0) return 100;
  if (p.totalFundRaisingB === 0n) return 0;
  return Math.max(0, Math.min(100, Number((p.realB * 1000n) / p.totalFundRaisingB) / 10));
}

/** Spot price of one whole base token in whole quote tokens, from the constant-product virtual reserves. */
export function curvePrice(p: Pick<LaunchpadPoolState, "virtualA" | "virtualB" | "realA" | "realB" | "mintDecimalsA" | "mintDecimalsB">): number | null {
  const a = p.virtualA - p.realA;
  if (a <= 0n) return null;
  const b = p.virtualB + p.realB;
  return (Number(b) / 10 ** p.mintDecimalsB) / (Number(a) / 10 ** p.mintDecimalsA);
}

/**
 * Constant-product quote for a buy of `amountB` (raw, after fees) — the same math the program runs, so it can
 * set a slippage floor. Fees come off the input first: `amountB * (1e6 - fees) / 1e6`.
 */
export function quoteBuy(p: Pick<LaunchpadPoolState, "virtualA" | "virtualB" | "realA" | "realB">, amountB: bigint, totalFeeRate: bigint): bigint {
  const inB = amountB - (amountB * totalFeeRate) / 1_000_000n;
  const a = p.virtualA - p.realA;
  const b = p.virtualB + p.realB;
  return a - (a * b) / (b + inB);
}

export function quoteSell(p: Pick<LaunchpadPoolState, "virtualA" | "virtualB" | "realA" | "realB">, amountA: bigint, totalFeeRate: bigint): bigint {
  const a = p.virtualA - p.realA;
  const b = p.virtualB + p.realB;
  const outB = b - (a * b) / (a + amountA);
  return outB - (outB * totalFeeRate) / 1_000_000n;
}
