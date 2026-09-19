#!/usr/bin/env node
// Runs `next dev` and the local cron loop together in one terminal. Ctrl+C stops both.
// Usage: npm run dev:all  (from web/)   |   PORT=3001 WORKER=off node scripts/dev-all.mjs
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const port = process.env.PORT ?? "3001";
const base = `http://localhost:${port}`;

const next = spawn("npx", ["next", "dev", "-p", port], { cwd: web, stdio: "inherit", env: process.env });
// StonkFun publishes no trade stream, so there is no worker to run alongside
const worker = null;

let cron;
async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/api/tokens`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
waitForServer().then((up) => {
  if (!up) return console.error(`[dev-all] ${base} did not come up; cron loop not started`);
  cron = spawn(process.execPath, [join(root, "scripts", "local-cron.mjs"), process.env.CRON_INTERVAL ?? "30"], {
    stdio: "inherit",
    env: { ...process.env, DEV_URL: base },
  });
});

function stop() {
  cron?.kill("SIGINT");
  worker?.kill("SIGINT");
  next.kill("SIGINT");
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => {
  cron?.kill("SIGINT");
  worker?.kill("SIGINT");
  process.exit(code ?? 0);
});
