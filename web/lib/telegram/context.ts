import type { Context } from "grammy";
import type { TelegramUserDoc } from "../db/types";

/** Every update the bot handles comes from a private chat with a known user (see the first middleware in bot.ts). */
export type BotContext = Context & { user: TelegramUserDoc };

/** A callback handler's answer: a short toast for the button press, or nothing. */
export type Toast = string | void;
