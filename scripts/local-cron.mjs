#!/usr/bin/env node
// Local stand-in for the Vercel cron: calls /api/cron/sync, /api/cron/stonkfun and /api/cron/dividends on an interval
// so vaults and launches from other wallets show up while developing.
// Usage: node scripts/local-cron.mjs [intervalSeconds]  (reads web/.env.local)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, "web", ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const base = process.env.DEV_URL ?? "http://localhost:3001";
const interval = Number(process.argv[2] ?? 60) * 1000;
const secret = process.env.CRON_SECRET ?? env.CRON_SECRET ?? "";
const headers = { authorization: `Bearer ${secret}` };
const stamp = () => new Date().toISOString();

async function tick() {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/cron/sync`, { headers });
    const body = await res.json().catch(() => ({}));
    const summary = res.ok
      ? `sync: sigs=${body.signatures} txs=${body.transactions} events=${body.events} vaults+${body.vaultsCreated}${body.reconciled ? " reconciled" : ""}${body.caughtUp ? "" : " (not caught up)"}`
      : `sync: HTTP ${res.status} ${body.error ?? ""}`;
    console.log(stamp(), summary, `${Date.now() - started}ms`);
  } catch (e) {
    console.log(stamp(), `unreachable (${e.message}) - is the app running at ${base}? start it with \`npm run dev\` in web/, or use \`npm run dev:all\``);
  }
}

/** StonkFun catalogue: newest launches + pool refreshes. */
async function stonkfunTick() {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/cron/stonkfun`, { headers });
    const body = await res.json().catch(() => ({}));
    console.log(stamp(), res.ok ? `stonkfun: fetched=${body.fetched} new=${body.inserted} refreshed=${body.refreshed}` : `stonkfun: HTTP ${res.status} ${body.error ?? ""}`, `${Date.now() - started}ms`);
  } catch (e) {
    console.log(stamp(), `stonkfun unreachable (${e.message})`);
  }
}

/** Dividend keeper (binds launches, harvests fees, publishes payout epochs); runs at half the sync cadence. */
async function dividendTick() {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/cron/dividends`, { headers });
    const body = await res.json().catch(() => ({}));
    const summary = res.ok
      ? body.enabled === false
        ? `dividends: idle (${body.reason ?? "disabled"})`
        : `dividends: vaults=${body.vaults} bound+${body.bound?.length ?? 0} harvested+${body.harvested?.length ?? 0} published+${body.published?.length ?? 0} delivered+${body.delivered?.length ?? 0}${body.skipped?.length ? ` skipped=${body.skipped.length} (${body.skipped[0].step}: ${body.skipped[0].reason})` : ""}`
      : `dividends: HTTP ${res.status} ${body.error ?? ""}`;
    console.log(stamp(), summary, `${Date.now() - started}ms`);
  } catch (e) {
    console.log(stamp(), `dividends unreachable (${e.message})`);
  }
}

console.log(`local cron -> ${base}/api/cron/{sync,stonkfun} every ${interval / 1000}s, /api/cron/dividends every ${(interval * 2) / 1000}s (Ctrl+C to stop)`);
await tick();
await stonkfunTick();
await dividendTick();
setInterval(tick, interval);
setInterval(stonkfunTick, interval);
setInterval(dividendTick, interval * 2);
