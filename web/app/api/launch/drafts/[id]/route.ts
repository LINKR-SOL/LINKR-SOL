import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * A launch drafted in the Telegram bot, for the wizard to open prefilled (`/launch?draft=<id>`) so the user can
 * sign with their own wallet. The id is an unguessable random token handed out only in the user's chat; the draft
 * holds the coin's public details and nothing secret.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { getDraft, draftForSite } = await import("@/lib/telegram/drafts");
    const d = await getDraft(id);
    if (!d || d.status === "cancelled") return error("this Telegram draft does not exist or was cancelled", 404);
    if (d.status === "launched") return error("this Telegram draft was already launched", 410);
    if (d.status === "launching" || d.vault) return error("this Telegram draft is being launched with the bot wallet", 409);
    return json({ draft: draftForSite(d) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[launch/drafts]", e);
    return error("could not load the draft", 503);
  }
}
