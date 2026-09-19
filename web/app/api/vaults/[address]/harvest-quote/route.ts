import { harvestQuote } from "@/lib/api/vaults";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isBase58Address(address)) return error("invalid address");
  const slippage = Number(new URL(req.url).searchParams.get("slippageBps") ?? 100);
  try {
    return json(await harvestQuote(address, Number.isFinite(slippage) ? Math.min(Math.max(slippage, 1), 5000) : 100));
  } catch (e) {
    return error(`quote failed: ${(e as Error).message}`, 400);
  }
}
