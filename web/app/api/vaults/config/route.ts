import { vaultConfig } from "@/lib/api/vaults";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await vaultConfig(), { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    console.error("[vaults/config]", e);
    return error(`config unavailable: ${(e as Error).message}`, 503);
  }
}
