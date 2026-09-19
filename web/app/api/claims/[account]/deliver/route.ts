import { isCustodial } from "@/lib/solana/cluster";
import { verifySignedAction, type SignedAction } from "@/lib/custody/auth";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Custodial "Claim": the holder proves the wallet with a signature and the keeper delivers every claimable
 * payout of theirs in `vault` right away. (In program mode holders claim with their own transaction.)
 */
export async function POST(req: Request, ctx: { params: Promise<{ account: string }> }) {
  if (!isCustodial) return error("not a custodial deployment", 404);
  const { account } = await ctx.params;
  if (!isBase58Address(account)) return error("invalid address");
  let body: SignedAction & { vault: string };
  try {
    body = (await req.json()) as SignedAction & { vault: string };
  } catch {
    return error("invalid body");
  }
  if (!isBase58Address(body.vault ?? "")) return error("invalid vault");
  const check = verifySignedAction(body, { action: "claim", target: body.vault });
  if (!check.ok) return error(check.reason, 401);
  if (check.pubkey !== account) return error("signature does not match the account", 403);
  try {
    const { deliverNow } = await import("@/lib/custody/keeper");
    const delivered = await deliverNow(body.vault, account);
    if (delivered.length === 0) return error("nothing claimable right now", 409);
    return json({ ok: true, delivered });
  } catch (e) {
    console.error("[claims deliver]", e);
    return error((e as Error).message, 500);
  }
}
