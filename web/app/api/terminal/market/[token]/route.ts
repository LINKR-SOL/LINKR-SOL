import { getMarket } from "@/lib/stonkfun/live";
import { error, isBase58Address, json } from "@/lib/serialize";
import { isHidden } from "@/lib/hidden";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isBase58Address(token)) return error("invalid mint");
  if (isHidden(token)) return error("not found", 404);
  return json(await getMarket(token), { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" } });
}
