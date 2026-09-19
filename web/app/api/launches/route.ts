import { activeCluster } from "@/lib/solana/cluster";
import { collections } from "@/lib/db/collections";
import { launchToJson } from "@/lib/api/launches";
import { LaunchInputError } from "@/lib/launch/errors";
import { recordLaunch, type RecordLaunchInput } from "@/lib/launch/record";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** Coins launched on StonkFun that LINKR knows about (vault-created ones first), newest first. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const creator = url.searchParams.get("creator");
  const deployer = url.searchParams.get("deployer");
  try {
    const c = await collections();
    const filter: Record<string, unknown> = { cluster: activeCluster };
    if (creator) filter.creator = creator;
    if (deployer) filter.deployer = deployer;
    const docs = await c.launches.find(filter).sort({ launchedAt: -1 }).limit(Math.min(Number(url.searchParams.get("limit") ?? 50), 200)).toArray();
    return json({ launches: docs.map((l) => launchToJson(l)) });
  } catch (e) {
    console.error("[launches]", e);
    return error("database unavailable", 503);
  }
}

/**
 * Registers a coin the launch wizard just created, so the vault page shows it before the keeper binds it.
 * Only accepted when the LaunchLab pool exists on chain (the mint and quote are verified, nothing is trusted
 * from the body). `draft` is a Telegram draft the wizard was opened from: its chat hears that the coin is live.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as RecordLaunchInput & { draft?: string };
  try {
    const { launch, creator } = await recordLaunch(body);
    if (body.draft && body.mint) {
      const { completeDraftFromSite } = await import("@/lib/telegram/drafts");
      await completeDraftFromSite(body.draft, { mint: body.mint, vault: creator, signature: body.signature ?? null, symbol: launch.symbol, name: launch.name }).catch((e) =>
        console.error("[launches:post] telegram draft", e),
      );
    }
    return json({ launch });
  } catch (e) {
    if (e instanceof LaunchInputError) return error(e.message, e.status);
    console.error("[launches:post]", e);
    return error("could not register launch", 500);
  }
}
