import { ingestTx } from "@/lib/indexer/txIngest";
import { error, isBase58Signature, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Cheap per-instance rate limit: 30 requests / minute / IP.
const buckets = new Map<string, { count: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  b.count++;
  return b.count > 30;
}

/** Called by the frontend after a confirmation so the user's own action shows up immediately. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return error("rate limited", 429);
  let body: { signature?: string; txHash?: string };
  try {
    body = await req.json();
  } catch {
    return error("invalid JSON");
  }
  const signature = body.signature ?? body.txHash;
  if (!signature || !isBase58Signature(signature)) return error("signature must be a base58 transaction signature");
  try {
    const res = await ingestTx(signature);
    return json(res, { status: res.status === "not_found" ? 404 : 200 });
  } catch (e) {
    console.error("[sync/tx]", e);
    return error(`ingest failed: ${(e as Error).message}`, 500);
  }
}
