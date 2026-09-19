// Spike 4: sample the free PumpPortal WebSocket (new tokens + migrations, optionally trades) and measure
// message rates and payload shape. This is the live feed reader behind the home tape.
//
// Run: DURATION_S=90 npm run spike4        (PUMPPORTAL_API_KEY optional; TRADE_MINTS=comma,separated to sample trades)
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const DURATION_S = Number(process.env.DURATION_S ?? 90);
const KEY = process.env.PUMPPORTAL_API_KEY;
const TRADE_MINTS = (process.env.TRADE_MINTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.join(process.cwd(), "out", "pumpportal.jsonl");

const url = `wss://pumpportal.fun/api/data${KEY ? `?api-key=${KEY}` : ""}`;
const ws = new WebSocket(url);
const out = fs.createWriteStream(OUT, { flags: "a" });
const counts = new Map<string, number>();
const seenKeys = new Map<string, Set<string>>();
let bytes = 0;
let firstMint: string | null = null;
const started = Date.now();

ws.on("open", () => {
  console.log(`connected ${url.replace(/api-key=.*/, "api-key=***")}, sampling ${DURATION_S}s → ${OUT}`);
  ws.send(JSON.stringify({ method: "subscribeNewToken" }));
  ws.send(JSON.stringify({ method: "subscribeMigration" }));
  if (TRADE_MINTS.length) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: TRADE_MINTS }));
});

ws.on("message", (raw) => {
  const text = raw.toString();
  bytes += text.length;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(text);
  } catch {
    counts.set("unparseable", (counts.get("unparseable") ?? 0) + 1);
    return;
  }
  const type = String(msg.txType ?? msg.message ?? "unknown");
  counts.set(type, (counts.get(type) ?? 0) + 1);
  if (!seenKeys.has(type)) seenKeys.set(type, new Set(Object.keys(msg)));
  if (type === "create" && !firstMint && typeof msg.mint === "string") firstMint = msg.mint;
  out.write(JSON.stringify({ at: Date.now(), ...msg }) + "\n");
  if ((counts.get(type) ?? 0) <= 2) console.log(`  sample ${type}: ${text.slice(0, 300)}`);
});

ws.on("error", (e) => console.error("ws error", e.message));
ws.on("close", (code, reason) => console.log(`closed ${code} ${reason.toString()}`));

setTimeout(() => {
  const s = (Date.now() - started) / 1000;
  console.log(`\n--- ${s.toFixed(0)}s, ${(bytes / 1024).toFixed(1)} KiB ---`);
  for (const [k, v] of counts) console.log(`  ${k.padEnd(12)} ${String(v).padStart(6)}  (${(v / s * 60).toFixed(1)}/min)  keys: ${[...(seenKeys.get(k) ?? [])].join(",")}`);
  if (firstMint) console.log(`\nfirst new mint seen (use for spike 3): ${firstMint}`);
  ws.close();
  out.end();
  setTimeout(() => process.exit(0), 500);
}, DURATION_S * 1000);
