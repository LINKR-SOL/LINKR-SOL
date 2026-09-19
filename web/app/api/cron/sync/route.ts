import { runRangeSync } from "@/lib/indexer/sync";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel cron target (every minute on Pro). Also callable by an external pinger with the same bearer secret. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return error("unauthorized", 401);
  try {
    const report = await runRangeSync({ budgetMs: 45_000 });
    return json(report);
  } catch (e) {
    console.error("[cron/sync]", e);
    return error(`sync failed: ${(e as Error).message}`, 500);
  }
}
