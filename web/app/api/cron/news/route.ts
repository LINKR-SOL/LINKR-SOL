import { collectNews } from "@/lib/news/collect";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Newswire collection. Vercel cron target; also callable by an external pinger with the
 * same bearer secret the other cron routes use.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return error("unauthorized", 401);

  try {
    return json(await collectNews());
  } catch (e) {
    console.error("[cron/news]", e);
    return error(`news collection failed: ${(e as Error).message}`, 500);
  }
}
