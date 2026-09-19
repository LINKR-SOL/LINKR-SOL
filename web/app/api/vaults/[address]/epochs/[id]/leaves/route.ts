import { epochToJson, leafToJson } from "@/lib/api/vaults";
import { activeCluster } from "@/lib/solana/cluster";
import { collections } from "@/lib/db/collections";
import { error, isBase58Address, json } from "@/lib/serialize";
import { isHidden } from "@/lib/hidden";

export const dynamic = "force-dynamic";

/** Full per-holder breakdown of an epoch (weights, amounts, proofs) so anyone can audit or recompute the root. */
export async function GET(req: Request, ctx: { params: Promise<{ address: string; id: string }> }) {
  const { address, id } = await ctx.params;
  const epochId = Number(id);
  if (!isBase58Address(address)) return error("invalid address");
  if (!Number.isInteger(epochId) || epochId <= 0) return error("invalid epoch id");
  if (isHidden(address)) return error("epoch not found", 404);
  const q = new URL(req.url).searchParams;
  const limit = Math.min(Number(q.get("limit") ?? 1000), 5000);
  const skip = Math.max(Number(q.get("skip") ?? 0), 0);
  try {
    const c = await collections();
    const epoch = await c.epochs.findOne({ _id: `${activeCluster}:${address}:${epochId}` });
    if (!epoch) return error("epoch not found", 404);
    const [leaves, total] = await Promise.all([
      c.epochLeaves.find({ cluster: activeCluster, vault: address, epochId }).sort({ account: 1 }).skip(skip).limit(limit).toArray(),
      c.epochLeaves.countDocuments({ cluster: activeCluster, vault: address, epochId }),
    ]);
    return json({ epoch: await epochToJson(epoch), leaves: leaves.map((l) => leafToJson(l, epoch.sumAcc)), total, skip, limit });
  } catch (e) {
    console.error("[vault/epochs/leaves]", e);
    return error("database unavailable", 503);
  }
}
