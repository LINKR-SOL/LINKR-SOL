import { readLaunchCost } from "@/lib/launch/cost";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** What a wallet must hold to get through both launch transactions, for a basket of `legs` stocks. */
export async function GET(req: Request) {
  const legs = Math.min(Math.max(Number(new URL(req.url).searchParams.get("legs") ?? 3), 1), 10);
  try {
    return json(await readLaunchCost(legs));
  } catch (e) {
    console.error("[launch/cost]", e);
    return error("could not read launch cost", 503);
  }
}
