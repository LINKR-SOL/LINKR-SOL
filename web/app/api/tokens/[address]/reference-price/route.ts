import { getPricesFor } from "@/lib/xstocks/prices";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** External reference price (Jupiter) for one mint; null when the aggregator has no route for it. */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isBase58Address(address)) return error("invalid address");
  try {
    const px = await getPricesFor([address]);
    const p = px.get(address);
    return json({ mint: address, priceUsd: p === undefined ? null : String(p), source: p === undefined ? null : "jupiter" });
  } catch {
    return json({ mint: address, priceUsd: null, source: "jupiter" });
  }
}
