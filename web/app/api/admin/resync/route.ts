import { resyncRange } from "@/lib/indexer/sync";
import { refreshVaults } from "@/lib/indexer/refresh";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Admin repair: re-ingest recent program transactions (idempotent) and/or force a full reconciliation. */
export async function POST(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) return error("unauthorized", 401);
  const body = (await req.json().catch(() => ({}))) as { until?: string | null; max?: number; reconcile?: boolean };
  try {
    if (body.reconcile) {
      await refreshVaults();
      return json({ reconciled: true });
    }
    const max = Math.min(Number(body.max ?? 2000), 20_000);
    return json(await resyncRange({ until: body.until ?? null, max }));
  } catch (e) {
    console.error("[admin/resync]", e);
    return error(`resync failed: ${(e as Error).message}`, 500);
  }
}
