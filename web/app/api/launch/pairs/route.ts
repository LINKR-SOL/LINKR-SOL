import { launchablePairs } from "@/lib/launchlab/pairs";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** The quote tokens a coin can be launched against right now, grouped by StonkFun's categories. */
export async function GET() {
  try {
    const pairs = await launchablePairs();
    return json({ pairs }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    console.error("[launch/pairs]", e);
    return error(`could not load quote tokens: ${(e as Error).message}`, 503);
  }
}
