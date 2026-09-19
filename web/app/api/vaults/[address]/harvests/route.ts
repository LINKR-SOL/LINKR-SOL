import { listHarvests } from "@/lib/api/vaults";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isBase58Address(address)) return error("invalid address");
  try {
    return json({ harvests: await listHarvests(address) });
  } catch (e) {
    console.error("[vault/harvests]", e);
    return error("database unavailable", 503);
  }
}
