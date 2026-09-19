/**
 * Owners that hold the launch coin but never earn a dividend: the vault itself, LaunchLab's pool authority (which
 * owns every curve's token vault, so custodies the unsold supply) and the CPMM pool authority after graduation.
 * Their balance is real supply, so it is tracked for the next snapshot, but it earns no weight — otherwise a
 * slice of every payout would be minted to liquidity nobody can claim.
 *
 * The keeper uses this when it computes an epoch and the claims API uses it to project the next one; they must
 * agree exactly, so both read it from here.
 */
import { PublicKey } from "@solana/web3.js";
import { activeCluster } from "../solana/cluster";
import { CPMM_AUTHORITY } from "../launchlab/ids";
import { launchpadAuth } from "../launchlab/pool";
import { collections } from "../db/collections";

export async function excludedOwners(vault: string, launchMint: string): Promise<Set<string>> {
  const c = await collections();
  const out = new Set<string>();
  const add = (a?: string | null) => {
    if (a && a !== PublicKey.default.toBase58()) out.add(a);
  };
  add(vault);
  add(launchpadAuth().toBase58());
  add(CPMM_AUTHORITY.toBase58());
  const launch = await c.launches.findOne({ _id: `${activeCluster}:${launchMint}` }, { projection: { bondingCurve: 1, pool: 1 } });
  add(launch?.bondingCurve);
  add(launch?.pool);
  (process.env.DIVIDEND_EXCLUDED ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .forEach(add);
  return out;
}
