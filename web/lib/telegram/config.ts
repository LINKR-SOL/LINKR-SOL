import { envText, envValue } from "../solana/cluster";

/**
 * The launch bot's settings. TELEGRAM_BOT_TOKEN comes from @BotFather; TELEGRAM_WEBHOOK_SECRET is any random
 * string Telegram echoes back on every webhook call so the route can tell real updates from forged ones;
 * TELEGRAM_WALLET_SECRET seeds every user's bot wallet (see wallets.ts).
 */
export const telegramToken = () => envValue("TELEGRAM_BOT_TOKEN");
export const telegramWebhookSecret = () => envValue("TELEGRAM_WEBHOOK_SECRET");
export const telegramEnabled = () => !!telegramToken();

/** The public site the bot links to (vault pages, the wizard for own-wallet signing). */
export function siteUrl(): string {
  const raw =
    envText(process.env.NEXT_PUBLIC_SITE_URL) ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3001");
  return raw.replace(/\/+$/, "");
}
