import { claimsFor } from "@/lib/api/vaults";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ account: string }> }) {
  const { account } = await ctx.params;
  if (!isBase58Address(account)) return error("invalid address");
  try {
    return json(await claimsFor(account));
  } catch (e) {
    console.error("[claims]", e);
    return error("database unavailable", 503);
  }
}
