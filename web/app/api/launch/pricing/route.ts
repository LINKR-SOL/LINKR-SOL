import { launchPricing } from "@/lib/launchlab/pricing";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * What the create instruction needs for a launch against `quote`: program and config ids, the platform to
 * attribute the pool to, the raise size, and the fee rates. Sourced from StonkFun on mainnet so the launch
 * matches theirs exactly and gets adopted.
 */
export async function GET(req: Request) {
  const quote = new URL(req.url).searchParams.get("quote") ?? "";
  if (!isBase58Address(quote)) return error("quote mint required");
  try {
    return json(await launchPricing(quote), { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch (e) {
    console.error("[launch/pricing]", e);
    return error(`could not price the launch: ${(e as Error).message}`, 503);
  }
}
