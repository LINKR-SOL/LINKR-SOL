/**
 * Runs the Telegram bot locally with long polling — no public URL needed.
 *
 *   npm run telegram:dev          # reads .env.local / .env (ENV_FILE=… to pick another)
 *
 * Use a separate bot from @BotFather for development: long polling only works while the bot has no webhook, so
 * this refuses to start against a bot whose webhook is set (that is the deployed bot) unless FORCE=1, which
 * deletes the webhook — and takes the deployed bot offline until `npm run telegram:setup` runs again.
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
  const { telegramBot } = await import("../lib/telegram/bot");
  const bot = await telegramBot();
  const info = await bot.api.getWebhookInfo();
  if (info.url) {
    if (process.env.FORCE !== "1") {
      throw new Error(`@${bot.botInfo.username} has a webhook (${info.url}) — it is the deployed bot. Use a separate dev bot token, or FORCE=1 to delete the webhook.`);
    }
    await bot.api.deleteWebhook();
  }
  process.once("SIGINT", () => void bot.stop());
  process.once("SIGTERM", () => void bot.stop());
  bot.catch((err) => console.error("[telegram:dev]", err.error));
  console.log(`@${bot.botInfo.username} is polling — open https://t.me/${bot.botInfo.username}`);
  await bot.start({ allowed_updates: ["message", "callback_query"] });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
