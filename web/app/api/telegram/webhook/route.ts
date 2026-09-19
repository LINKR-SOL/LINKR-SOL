import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import type { Update } from "grammy/types";
import { telegramWebhookSecret } from "@/lib/telegram/config";

export const dynamic = "force-dynamic";
// a bot-wallet launch (two confirmed transactions) runs in after() within this budget
export const maxDuration = 300;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Telegram's webhook. The secret header proves the call is Telegram's (setWebhook's secret_token, see
 * scripts/telegram-setup.ts). Each update is handled once, and the answer is always 200: a non-200 makes Telegram
 * redeliver the update, and a failure is already reported to the user in the chat.
 */
export async function POST(req: Request) {
  const secret = telegramWebhookSecret();
  if (!secret || !same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return new Response("unauthorized", { status: 401 });
  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return new Response("ok");
  }
  try {
    const [{ telegramBot }, { firstDelivery }, { setBackgroundRunner }] = await Promise.all([
      import("@/lib/telegram/bot"),
      import("@/lib/telegram/drafts"),
      import("@/lib/telegram/background"),
    ]);
    setBackgroundRunner((task) => after(task));
    if (!(await firstDelivery(update.update_id))) return new Response("ok");
    const bot = await telegramBot();
    await bot.handleUpdate(update);
  } catch (e) {
    console.error("[telegram:webhook]", e);
  }
  return new Response("ok");
}
