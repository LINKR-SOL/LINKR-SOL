import { activeCluster, isMainnet } from "@/lib/solana/cluster";
import { WSOL_MINT } from "@/lib/solana/program";
import { collections } from "@/lib/db/collections";
import { ensureTokens, tokenToJson, USDC_MINT } from "@/lib/api/tokens";
import { MAINNET_STOCK_TOKENS } from "@/lib/stock-tokens.generated";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

let seeded: Promise<void> | undefined;

/**
 * Makes sure the curated tokens exist in the `tokens` collection: SOL and USDC everywhere, every xStock on
 * mainnet (they have no devnet deployment). Reads decimals and Token-2022 extension state from chain once.
 */
function seedKnownTokens(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      await ensureTokens([WSOL_MINT.toBase58(), USDC_MINT]);
      if (isMainnet) await ensureTokens(MAINNET_STOCK_TOKENS.map((t) => t.mint), { kind: "xstock" });
    })().catch((e) => {
      seeded = undefined;
      throw e;
    });
  }
  return seeded;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kinds = url.searchParams.get("kind")?.split(",").filter(Boolean);
  try {
    await seedKnownTokens().catch((e) => console.warn("[tokens] seed failed:", (e as Error).message));
    const c = await collections();
    const filter: Record<string, unknown> = { cluster: activeCluster };
    if (kinds?.length) filter.kind = { $in: kinds };
    const docs = await c.tokens.find(filter).sort({ kind: 1, symbol: 1 }).toArray();
    return json(docs.map(tokenToJson), { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=300" } });
  } catch (e) {
    console.error("[tokens]", e);
    return error("database unavailable", 503);
  }
}
