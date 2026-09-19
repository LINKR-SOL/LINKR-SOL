import { enabledAdapters, ADAPTERS } from "@/lib/news/adapters";
import { sourceHealth } from "@/lib/news/store";
import { json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * Per-source availability and yield over a window — the `shadow-report` equivalent from
 * SOURCE_INVENTORY.md §7. A source that is enabled but returning nothing shows up here
 * rather than quietly thinning the wire.
 */
export async function GET(req: Request) {
  const hours = Math.min(168, Math.max(1, Number(new URL(req.url).searchParams.get("hours") ?? 24)));
  const enabled = new Set(enabledAdapters().map((a) => a.key));

  if (!process.env.MONGODB_URI?.trim()) {
    return json({
      configured: false,
      hours,
      sources: ADAPTERS.map((a) => ({ source: a.key, label: a.label, enabled: enabled.has(a.key) })),
    });
  }

  const health = await sourceHealth(hours);
  const byKey = new Map(health.map((h) => [h.source, h]));

  return json({
    configured: true,
    hours,
    sources: ADAPTERS.map((a) => {
      const stats = byKey.get(a.key);
      return {
        source: a.key,
        label: a.label,
        enabled: enabled.has(a.key),
        runs: stats?.runs ?? 0,
        items: stats?.items ?? 0,
        kept: stats?.kept ?? 0,
        errors: stats?.errors ?? 0,
        lastError: stats?.lastError ?? null,
        lastRunAt: stats?.lastRunAt ?? null,
        meanLatencyMs: stats?.meanLatencyMs ?? 0,
      };
    }),
  });
}
