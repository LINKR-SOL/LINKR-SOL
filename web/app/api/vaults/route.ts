import { listVaults } from "@/lib/api/vaults";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const vaults = await listVaults({
      creator: q.get("creator") ?? undefined,
      mint: q.get("mint") ?? q.get("token") ?? undefined,
      limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    });
    return json({ vaults });
  } catch (e) {
    console.error("[vaults]", e);
    return error("database unavailable", 503);
  }
}
