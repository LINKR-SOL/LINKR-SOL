import { runDividendKeeper } from "@/lib/indexer/dividendKeeper";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Dividend keeper cron (every 2 minutes on Vercel Pro). Binds launches to vaults, syncs coin balance streams,
 * harvests fees into stock baskets and publishes payout epochs. Guarded by a Mongo lease so overlapping runs never
 * send transactions twice. Same bearer secret as /api/cron/sync.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return error("unauthorized", 401);
  try {
    const report = await runDividendKeeper({ budgetMs: 240_000 });
    // the report only reaches the cron caller; log why steps failed so it shows up in the deployment's logs
    if (report.skipped.length) {
      const reasons = [...new Set(report.skipped.map((s) => `${s.step}: ${s.reason}`))];
      console.warn(`[cron/dividends] ${report.skipped.length} skipped · ${reasons.slice(0, 8).join(" | ").slice(0, 1_500)}`);
    }
    // and how far each coin's balance stream got, until they are all caught up: a payout waits on its stream
    const behind = report.streams.filter((s) => !s.caughtUp || !s.backfilled || s.error);
    if (behind.length) {
      const line = behind.map((s) => `${s.mint.slice(0, 6)} +${s.forward + s.backfill}${s.caughtUp ? "" : " behind"}${s.backfilled ? "" : " backfilling"}${s.error ? ` error: ${s.error.slice(0, 80)}` : ""}`);
      console.warn(`[cron/dividends] streams · ${line.join(" | ")}`);
    }
    return json(report);
  } catch (e) {
    console.error("[cron/dividends]", e);
    return error(`dividend keeper failed: ${(e as Error).message}`, 500);
  }
}
