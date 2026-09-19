import { serverConnection } from "../solana/connection";
import { readonlyProgram } from "../solana/program";
import { isCustodial } from "../solana/cluster";
import { solUsd } from "../xstocks/prices";
import { launchCost } from "../launch-cost";

/** Token-2022 ATAs carry extension TLV data; this is the size xStocks accounts come out at. */
const ATA_SIZE_T22 = 182;
const ATA_SIZE_CLASSIC = 165;

export interface LaunchCostQuote {
  lamportsPerSignature: string;
  priorityFeeMicroLamports: string;
  vaultRent: string;
  createCost: string;
  solUsd: number | null;
  /** both transactions: prepare the vault, then create the coin */
  withVault: { required: string; spend: string; headroom: string };
  /** only the create, for a vault that already exists */
  launchOnly: { required: string; spend: string; headroom: string };
}

/** What a wallet must hold to get through both launch transactions, for a basket of `legs` stocks. */
export async function readLaunchCost(legs: number): Promise<LaunchCostQuote> {
  const n = Math.min(Math.max(Math.floor(legs) || 1, 1), 10);
  const connection = serverConnection();
  // custodial: the vault is a plain wallet that only needs its rent floor; program: the Vault account's rent
  const vaultSpace = isCustodial ? 0 : readonlyProgram(connection).account.vault.size;
  const [vaultRent, ataT22, ataClassic, price, fee] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(vaultSpace),
    connection.getMinimumBalanceForRentExemption(ATA_SIZE_T22),
    connection.getMinimumBalanceForRentExemption(ATA_SIZE_CLASSIC),
    solUsd(),
    connection.getRecentPrioritizationFees().then((f) => f.reduce((m, x) => Math.max(m, x.prioritizationFee), 0)).catch(() => 0),
  ]);
  // the vault's quote token account (WSOL or the quote token) plus one Token-2022 account per basket leg
  const rent = BigInt(vaultRent) + BigInt(ataClassic) + BigInt(n) * BigInt(ataT22);
  const withVault = launchCost(rent, price, true);
  const launchOnly = launchCost(rent, price, false);
  const leg = (c: typeof withVault) => ({ required: c.required.toString(), spend: c.spend.toString(), headroom: c.headroom.toString() });
  return {
    lamportsPerSignature: "5000",
    priorityFeeMicroLamports: String(fee),
    vaultRent: rent.toString(),
    createCost: withVault.createCost.toString(),
    solUsd: price,
    withVault: leg(withVault),
    launchOnly: leg(launchOnly),
  };
}
