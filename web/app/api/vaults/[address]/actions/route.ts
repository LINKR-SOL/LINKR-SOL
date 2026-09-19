import { isCustodial } from "@/lib/solana/cluster";
import { verifySignedAction, type SignedAction } from "@/lib/custody/auth";
import { collections } from "@/lib/db/collections";
import { activeCluster } from "@/lib/solana/cluster";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = SignedAction & { action: "harvest" | "autoclaim" | "cancel"; enabled?: boolean; epochId?: number };

/**
 * Creator actions on a custodial vault, authorised by a wallet signature (see lib/custody/auth). In program mode
 * these are on-chain instructions the creator signs directly, so this route is custodial-only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ address: string }> }) {
  if (!isCustodial) return error("not a custodial deployment", 404);
  const { address } = await ctx.params;
  if (!isBase58Address(address)) return error("invalid address");
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return error("invalid body");
  }
  const check = verifySignedAction(body, { action: body.action, target: address });
  if (!check.ok) return error(check.reason, 401);
  const c = await collections();
  const v = await c.vaults.findOne({ _id: `${activeCluster}:${address}` });
  if (!v) return error("vault not found", 404);
  if (v.creator !== check.pubkey) return error("only the creator can do this", 403);
  try {
    const keeper = await import("@/lib/custody/keeper");
    const ledger = await import("@/lib/custody/ledger");
    switch (body.action) {
      case "harvest": {
        const res = await keeper.harvestNow(address);
        return json({ ok: true, ...res });
      }
      case "autoclaim": {
        await ledger.setCustodialAutoClaim(address, body.enabled === true);
        return json({ ok: true, autoClaim: body.enabled === true });
      }
      case "cancel": {
        const epochId = Number(body.epochId);
        const e = await c.epochs.findOne({ _id: `${activeCluster}:${address}:${epochId}` });
        if (!e || e.status !== "published") return error("epoch is not open", 409);
        if (e.claimableAt !== null && e.claimableAt <= Math.floor(Date.now() / 1000)) return error("the review window has closed", 409);
        await ledger.closeCustodialEpoch(address, epochId, "cancelled", null);
        return json({ ok: true, epochId });
      }
      default:
        return error("unknown action");
    }
  } catch (e) {
    console.error("[vault actions]", e);
    return error((e as Error).message, 500);
  }
}
