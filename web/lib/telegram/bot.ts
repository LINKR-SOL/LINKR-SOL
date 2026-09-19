import { Bot } from "grammy";
import { LaunchInputError } from "../launch/errors";
import { telegramToken } from "./config";
import { setUser, upsertTelegramUser } from "./drafts";
import { cancelActive, onDraftCallback, onDraftImage, onDraftText, startLaunch } from "./flow";
import { onWalletCallback, onWithdrawText, sendCoins, sendHome, sendWallet, startWithdraw } from "./wallet";
import type { BotContext, Toast } from "./context";
import { HELP_TEXT, HTML, esc, homeKeyboard } from "./ui";

/**
 * The LINKR launch bot. One grammY Bot, driven by the webhook route on Vercel (app/api/telegram/webhook) or by
 * long polling locally (scripts/telegram-dev.ts). It keeps no state in memory: users, drafts and processed update
 * ids live in MongoDB, so any instance can handle any update.
 */

export const BOT_COMMANDS = [
  { command: "launch", description: "Create a coin whose holders are paid in stocks" },
  { command: "wallet", description: "Your bot wallet: deposit, withdraw, export" },
  { command: "coins", description: "Coins you launched" },
  { command: "cancel", description: "Drop the draft in progress" },
  { command: "help", description: "How LINKR works" },
];

/** Builds the bot with every handler registered (not initialised: see telegramBot). */
export function buildTelegramBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  // private chats only; load the user; turn any failure into a reply instead of a silent drop
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== "private") {
      if (ctx.message?.text?.startsWith("/") && ctx.chat) await ctx.reply("Open a private chat with me to launch a coin.").catch(() => {});
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    try {
      ctx.user = await upsertTelegramUser(ctx.from, ctx.chat.id);
      // any command abandons a half-typed withdrawal
      if (ctx.user.awaiting && ctx.message?.text?.startsWith("/")) {
        await setUser(ctx.user.tgUserId, { awaiting: null, pendingWithdraw: null });
        const cancelledWithdraw = ctx.message.text.startsWith("/cancel");
        ctx.user.awaiting = null;
        if (cancelledWithdraw) {
          await ctx.reply("Withdrawal cancelled.");
          return;
        }
      }
      await next();
    } catch (e) {
      console.error("[telegram]", e);
      const msg = e instanceof LaunchInputError ? e.message : "Something went wrong on our side. Try again in a moment.";
      await ctx.reply(`⚠️ ${esc(msg)}`, HTML).catch(() => {});
    }
  });

  bot.command(["start", "menu"], (ctx) => sendHome(ctx));
  bot.command("help", (ctx) => ctx.reply(HELP_TEXT, { ...HTML, reply_markup: homeKeyboard() }));
  bot.command(["launch", "new"], (ctx) => startLaunch(ctx));
  bot.command("wallet", (ctx) => sendWallet(ctx));
  bot.command("withdraw", (ctx) => startWithdraw(ctx));
  bot.command("coins", (ctx) => sendCoins(ctx));
  bot.command("cancel", (ctx) => cancelActive(ctx));

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    let toast: Toast = undefined;
    try {
      if (data === "home:launch") await startLaunch(ctx);
      else if (data === "home:wallet") await sendWallet(ctx);
      else if (data === "home:coins") await sendCoins(ctx);
      else if (data.startsWith("w:") || data.startsWith("wd:")) toast = await onWalletCallback(ctx, data);
      else toast = await onDraftCallback(ctx, data);
    } finally {
      await ctx.answerCallbackQuery(toast ? { text: toast } : undefined).catch(() => {});
    }
  });

  bot.on("message:photo", (ctx) => {
    const sizes = ctx.message.photo;
    return onDraftImage(ctx, sizes[sizes.length - 1], "image/jpeg", undefined, { isPhoto: true });
  });
  bot.on("message:document", (ctx) => onDraftImage(ctx, ctx.message.document, ctx.message.document.mime_type, ctx.message.document.file_name));
  bot.on("message:text", (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return ctx.reply("I don't know that one. Here's what I can do:", { reply_markup: homeKeyboard() });
    if (ctx.user.awaiting === "withdraw") return onWithdrawText(ctx, text);
    return onDraftText(ctx, text);
  });
  bot.on("message", (ctx) => ctx.reply("Send text or an image, or tap /help."));

  return bot;
}

let cached: { token: string; bot: Promise<Bot<BotContext>> } | undefined;

/** The bot, initialised once per instance (one getMe call), rebuilt if the token changes. */
export function telegramBot(): Promise<Bot<BotContext>> {
  const token = telegramToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!cached || cached.token !== token) {
    const bot = buildTelegramBot(token);
    cached = {
      token,
      bot: bot.init().then(
        () => bot,
        (e) => {
          cached = undefined;
          throw e;
        },
      ),
    };
  }
  return cached.bot;
}
