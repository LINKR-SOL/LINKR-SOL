import type { LaunchDoc } from "../db/types";
import type { LaunchJson } from "../api-types";
import { coinUrl } from "../launchlab/ids";

export function launchToJson(l: LaunchDoc, solRaised?: bigint | null): LaunchJson {
  return {
    mint: l.mint,
    symbol: l.symbol,
    name: l.name,
    logo: l.logo ?? null,
    description: l.description ?? null,
    decimals: l.decimals,
    creator: l.creator,
    deployer: l.deployer ?? null,
    bondingCurve: l.bondingCurve,
    quoteMint: l.quoteMint ?? null,
    complete: l.complete,
    pool: l.pool ?? null,
    marketCapSol: l.marketCapSol ?? null,
    solRaised: solRaised === undefined || solRaised === null ? null : solRaised.toString(),
    launchedAt: l.launchedAt.toISOString(),
    graduatedAt: l.graduatedAt ? l.graduatedAt.toISOString() : null,
    launchSignature: l.launchSignature ?? null,
    url: coinUrl(l.mint),
  };
}
