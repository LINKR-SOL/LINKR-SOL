import { Api } from "grammy";
import { telegramToken } from "./config";

let cached: Api | null = null;

/** A bare Bot API client for sending outside an update (background launches, the site's draft hook). */
export function telegramApi(): Api {
  const token = telegramToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!cached || cached.token !== token) cached = new Api(token);
  return cached;
}

/** Bot API rejects an edit that changes nothing; that is not an error worth surfacing. */
export const ignoreNotModified = (e: unknown) => {
  if (!/message is not modified/i.test(String((e as Error)?.message ?? e))) throw e;
};
