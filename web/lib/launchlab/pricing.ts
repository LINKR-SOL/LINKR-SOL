import { PublicKey } from "@solana/web3.js";
import { LaunchpadPoolInitParam } from "@raydium-io/raydium-sdk-v2";
import { envText, isMainnet } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { LAUNCHLAB_PROGRAM_ID, STONKFUN_API, platformId as configuredPlatform } from "./ids";
import { findPair } from "./pairs";
import { fetchLaunchpadConfig, fetchPlatform, launchpadConfigId } from "./pool";

/**
 * Everything the create instruction needs for a launch against one quote token. On mainnet the numbers come
 * from StonkFun's pricing endpoint, so a launch built here opens and graduates exactly where one built on their
 * site would — that is what makes them adopt the pool (token page, chart, fee forwarding). On devnet the same
 * shape is assembled from the LaunchLab global config and LINKR's own platform.
 *
 * Server side only: it reads env and talks to StonkFun. The wizard fetches it through /api/launch/pricing.
 */
export interface LaunchPricing {
  programId: string;
  configId: string;
  platformId: string;
  /** StonkFun's curve-rule account, appended read-only to the create instruction; null where the platform has none */
  curveRuleId: string | null;
  quote: { mint: string; symbol: string; decimals: number; tokenProgram: string };
  baseDecimals: number;
  supply: string;
  totalSellA: string;
  /** raw quote units the curve raises before graduating */
  totalFundRaisingB: string;
  migrateType: "cpmm";
  cpmmCreatorFeeOn: number;
  /** curve fee (global config) + platform fee + on-chain creator fee, each 1e6 = 100% */
  fees: { trade: string; platform: string; creator: string };
  /** opening virtual reserves the program will derive, for previewing a dev buy; null when unknown */
  virtual: { a: string; b: string } | null;
  source: "stonkfun" | "chain";
}

interface StonkPricing {
  quote: { mint: string; symbol: string; decimals: number; tokenProgram: string };
  raise: { raw: string };
  curve: {
    programId: string;
    configId: string;
    curveType: string;
    migrateType: string;
    baseDecimals: number;
    supply: string;
    totalSellA: string;
    cpmmCreatorFeeOn: number;
    derived?: { virtualA: string; virtualB: string };
  };
  platform: { standard: string; reward: string };
  curveRule?: { standard: string; reward: string };
}

const cache = new Map<string, { at: number; value: LaunchPricing }>();
const TTL = 60_000;

export async function launchPricing(quoteMint: string): Promise<LaunchPricing> {
  const hit = cache.get(quoteMint);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = isMainnet ? await fromStonkfun(quoteMint) : await fromChain(quoteMint);
  cache.set(quoteMint, { at: Date.now(), value });
  return value;
}

async function fromStonkfun(quoteMint: string): Promise<LaunchPricing> {
  const res = await fetch(`${STONKFUN_API}/launchlab/pricing?quoteMint=${quoteMint}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`stonkfun pricing ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { data?: StonkPricing; error?: { message?: string } };
  const d = body.data;
  if (!d) throw new Error(body.error?.message ?? "stonkfun pricing: empty response");
  if (d.curve.migrateType !== "cpmm" || d.curve.curveType !== "ConstantCurve") throw new Error(`unexpected curve shape ${d.curve.curveType}/${d.curve.migrateType}`);
  const override = configuredPlatform();
  const platform = override ?? new PublicKey(d.platform.standard);
  const curveRule = override && !override.equals(new PublicKey(d.platform.standard)) ? null : (d.curveRule?.standard ?? null);
  const fees = await feeRates(new PublicKey(d.curve.configId), platform);
  return {
    programId: d.curve.programId,
    configId: d.curve.configId,
    platformId: platform.toBase58(),
    curveRuleId: curveRule,
    quote: d.quote,
    baseDecimals: d.curve.baseDecimals,
    supply: d.curve.supply,
    totalSellA: d.curve.totalSellA,
    totalFundRaisingB: d.raise.raw,
    migrateType: "cpmm",
    cpmmCreatorFeeOn: d.curve.cpmmCreatorFeeOn,
    fees,
    virtual: d.curve.derived ? { a: d.curve.derived.virtualA, b: d.curve.derived.virtualB } : null,
    source: "stonkfun",
  };
}

async function fromChain(quoteMint: string): Promise<LaunchPricing> {
  const pair = await findPair(quoteMint);
  if (!pair) throw new Error("that quote token is not launchable on this cluster");
  const platform = configuredPlatform();
  if (!platform) throw new Error("LAUNCHLAB_PLATFORM_ID is not set (run scripts/launchlab-devnet-platform.ts)");
  const connection = serverConnection();
  const configId = launchpadConfigId(new PublicKey(quoteMint), 0, 0);
  const config = await fetchLaunchpadConfig(connection, configId);
  if (!config) throw new Error(`no LaunchLab config for ${pair.symbol} on this cluster`);
  // the raise, in whole quote units; the devnet default keeps a test coin from graduating by accident
  const raiseWhole = Number(envText(process.env.LAUNCHLAB_RAISE) ?? "85");
  let raise = BigInt(Math.round(raiseWhole * 10 ** pair.decimals));
  if (raise < config.minFundRaisingB) raise = config.minFundRaisingB;
  const fees = await feeRates(configId, platform);
  return {
    programId: LAUNCHLAB_PROGRAM_ID.toBase58(),
    configId: configId.toBase58(),
    platformId: platform.toBase58(),
    curveRuleId: envText(process.env.LAUNCHLAB_CURVE_RULE_ID) ?? null,
    quote: { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, tokenProgram: pair.tokenProgram },
    baseDecimals: LaunchpadPoolInitParam.decimals,
    supply: LaunchpadPoolInitParam.supply.toString(),
    totalSellA: LaunchpadPoolInitParam.totalSellA.toString(),
    totalFundRaisingB: raise.toString(),
    migrateType: "cpmm",
    cpmmCreatorFeeOn: 0,
    fees,
    virtual: null,
    source: "chain",
  };
}

async function feeRates(configId: PublicKey, platform: PublicKey): Promise<LaunchPricing["fees"]> {
  const connection = serverConnection();
  const [config, plat] = await Promise.all([fetchLaunchpadConfig(connection, configId), fetchPlatform(connection, platform)]);
  return {
    trade: (config?.tradeFeeRate ?? 0n).toString(),
    platform: (plat?.feeRate ?? 0n).toString(),
    creator: (plat?.creatorFeeRate ?? 0n).toString(),
  };
}

/** Sum of every fee a curve trade pays, 1e6 = 100%. */
export const totalFeeRate = (p: Pick<LaunchPricing, "fees">) => BigInt(p.fees.trade) + BigInt(p.fees.platform) + BigInt(p.fees.creator);
