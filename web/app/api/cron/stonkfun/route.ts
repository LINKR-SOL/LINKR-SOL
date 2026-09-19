import { activeCluster } from "@/lib/solana/cluster";
import { collections, ensureIndexes } from "@/lib/db/collections";
import type { LaunchDoc } from "@/lib/db/types";
import { absoluteUrl, fetchLaunches } from "@/lib/stonkfun/client";
import { FEED_CLUSTER } from "@/lib/stonkfun/live";
import { refreshLaunches } from "@/lib/indexer/refresh";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * StonkFun catalogue cron (every minute): the newest launches from the public ledger — the only place the API
 * names a coin's creator, which is how a coin launched through LINKR is recognised from the outside, and what
 * the pulse's "launched in the last 24h" counts from — plus pool-state refreshes for the coins that matter to us.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return error("unauthorized", 401);
  try {
    await ensureIndexes();
    const c = await collections();
    // four pages of 25: StonkFun launches a coin or two a minute, so a minute's cron keeps the ledger complete
    const rows = (await Promise.all([1, 2, 3, 4].map((page) => fetchLaunches(page).catch(() => [])))).flat();
    const now = new Date();
    let inserted = 0;
    for (const row of rows) {
      const doc: LaunchDoc = {
        _id: `${FEED_CLUSTER}:${row.mint}`,
        cluster: FEED_CLUSTER,
        mint: row.mint,
        bondingCurve: row.pool,
        quoteMint: row.quote?.mint ?? null,
        creator: row.creator,
        deployer: null,
        symbol: row.symbol.slice(0, 13),
        name: row.name.slice(0, 32),
        uri: null,
        logo: absoluteUrl(row.logoUrl),
        description: null,
        decimals: 6,
        complete: false,
        pool: null,
        marketCapSol: null,
        launchedAt: new Date(row.createdAt),
        launchedAtSlot: null,
        launchSignature: null,
        graduatedAt: null,
        source: "stonkfun",
        updatedAt: now,
      };
      // fields that change over a coin's life go in $set; everything else only on insert (Mongo rejects overlap)
      const { creator, logo, updatedAt, ...insertOnly } = doc;
      const res = await c.launches.updateOne({ _id: doc._id }, { $setOnInsert: insertOnly, $set: { creator, logo, updatedAt } }, { upsert: true });
      if (res.upsertedCount) inserted++;
    }
    // coins bound to vaults on this cluster that are still missing metadata or have not graduated yet
    const stale = await c.launches
      .find({ cluster: activeCluster, source: { $in: ["indexer", "launch"] }, $or: [{ symbol: "" }, { complete: false }] }, { projection: { mint: 1 } })
      .sort({ updatedAt: 1 })
      .limit(20)
      .toArray();
    if (stale.length) await refreshLaunches(stale.map((l) => l.mint));
    return json({ fetched: rows.length, inserted, refreshed: stale.length });
  } catch (e) {
    console.error("[cron/stonkfun]", e);
    return error(`stonkfun sync failed: ${(e as Error).message}`, 500);
  }
}
