import { isCustodial } from "@/lib/solana/cluster";
import { LaunchInputError } from "@/lib/launch/errors";
import { registerCustodialVault, type RegisterVaultInput } from "@/lib/launch/vault";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * Custodial mode's `create_vault`: registers the vault and returns its address (a keypair only the keeper can
 * reconstruct). No transaction, no rent. The launch wizard then funds the wallet's floor + token accounts and
 * launches the coin on LaunchLab with this address as creator; the keeper binds it when it sees the pool.
 */
export async function POST(req: Request) {
  if (!isCustodial) return error("not a custodial deployment", 404);
  let b: RegisterVaultInput;
  try {
    b = (await req.json()) as RegisterVaultInput;
  } catch {
    return error("invalid body");
  }
  try {
    return json(await registerCustodialVault(b));
  } catch (e) {
    if (e instanceof LaunchInputError) return error(e.message, e.status);
    console.error("[vaults/create]", e);
    return error((e as Error).message, 500);
  }
}
