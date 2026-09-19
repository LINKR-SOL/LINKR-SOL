/**
 * Points the Telegram bot at this deployment and sets its command menu and profile text.
 *
 *   npm run telegram:setup                     # reads .env.local / .env
 *   ENV_FILE=.env.mainnet npm run telegram:setup
 *
 * Needs TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_WEBHOOK_SECRET (any random string: `openssl rand -hex 32`)
 * and NEXT_PUBLIC_SITE_URL (the public https origin). The same TELEGRAM_WEBHOOK_SECRET must be set on the
 * deployment, or the webhook route answers 401. Re-run it whenever the URL or the secret changes.
 */
import fs from "node:fs";

for (const file of [process.env.ENV_FILE, ".env.local", ".env"].filter((f): f is string => !!f)) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const { Api } = await import("grammy");
  const { BOT_COMMANDS } = await import("../lib/telegram/bot");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be 1-256 characters of A-Z a-z 0-9 _ -");
  if (!/^https:\/\//.test(site)) throw new Error("NEXT_PUBLIC_SITE_URL must be the public https origin (Telegram only calls https webhooks)");

  const api = new Api(token);
  const me = await api.getMe();
  const url = await finalUrl(`${site}/api/telegram/webhook`);
  await api.setWebhook(url, { secret_token: secret, allowed_updates: ["message", "callback_query"], max_connections: 40 });
  await api.setMyCommands(BOT_COMMANDS);
  await api.setMyName(BOT_NAME);
  await api.setMyShortDescription(BOT_SHORT_DESCRIPTION);
  await api.setMyDescription(BOT_DESCRIPTION);
  const info = await api.getWebhookInfo();
  console.log(`@${me.username} → ${info.url}`);
  console.log(`pending updates: ${info.pending_update_count}${info.last_error_message ? ` · last error: ${info.last_error_message}` : ""}`);
}

/** The bot's profile, in the LINKR voice. The short description shows on its profile and in shares (≤ 120 characters). */
const BOT_NAME = "LINKR";
const BOT_SHORT_DESCRIPTION = "Every market starts with a reason. Launch StonkFun coins whose holders earn tokenised stocks.";
const BOT_DESCRIPTION =
  "LINKR. Every market starts with a reason.\n\nDiscover the thesis. Hold the coin. Earn the stocks.\n\nLaunch a StonkFun coin from this chat. Its trading fees buy the tokenised stocks you choose and airdrop them to holders, weighted by how much and how long they hold.\n\nUnaudited and custodial: start with small amounts.";

/**
 * Telegram does not follow redirects (an apex → www redirect makes every update fail with 308), so the webhook is
 * registered at the URL the redirects end at. The probe carries no secret: the route answers it with 401.
 */
async function finalUrl(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: "{}" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) {
      if (res.status === 404) throw new Error(`${current} answers 404 — deploy the webhook route first`);
      return current;
    }
    current = new URL(location, current).toString();
  }
  throw new Error(`${url} redirects too many times`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
