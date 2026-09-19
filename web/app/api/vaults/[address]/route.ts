import { getVault } from "@/lib/api/vaults";
import { refreshVaults } from "@/lib/indexer/refresh";
import { error, isBase58Address, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isBase58Address(address)) return error("invalid address");
  try {
    if (new URL(req.url).searchParams.get("refresh") === "1") await refreshVaults([address]).catch(() => {});
    const vault = await getVault(address);
    if (!vault) return error("vault not found", 404);
    return json(vault);
  } catch (e) {
    console.error("[vault]", e);
    return error("database unavailable", 503);
  }
}
