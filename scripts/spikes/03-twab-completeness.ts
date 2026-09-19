// Spike 3: can we rebuild a pump coin's full holder-balance history from plain RPC (getSignaturesForAddress on the
// mint + pre/post token balances), completely enough to drive TWAB? Reconciles the rebuilt balances against the
// chain's current token accounts.
//
// Run: MINT=<base58> RPC_URL=https://api.mainnet-beta.solana.com npm run spike3     (MAX_SIGS caps the walk)
import { Connection, PublicKey, type ConfirmedSignatureInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const MINT = process.env.MINT;
const MAX_SIGS = Number(process.env.MAX_SIGS ?? 4000);
const BATCH = Number(process.env.BATCH ?? 25);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 400);
if (!MINT) throw new Error("MINT=<mint address> is required");

const connection = new Connection(RPC, "confirmed");
const mint = new PublicKey(MINT);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rateLimited = 0;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e as Error).message);
      if (attempt < 6 && /429|Too many|rate/i.test(msg)) {
        rateLimited++;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`${label}: ${msg}`);
    }
  }
}

async function walkSignatures(): Promise<ConfirmedSignatureInfo[]> {
  const all: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  while (all.length < MAX_SIGS) {
    const page = await withRetry(() => connection.getSignaturesForAddress(mint, { before, limit: 1000 }, "confirmed"), "getSignaturesForAddress");
    if (page.length === 0) break;
    all.push(...page);
    before = page[page.length - 1].signature;
    process.stdout.write(`  signatures: ${all.length}\r`);
    if (page.length < 1000) break;
    await sleep(SLEEP_MS);
  }
  console.log(`  signatures: ${all.length}${all.length >= MAX_SIGS ? " (capped — history NOT complete)" : ""}`);
  return all.reverse(); // oldest first
}

interface Delta { owner: string; account: string; delta: bigint; }

function deltasOf(tx: ParsedTransactionWithMeta): Delta[] {
  const meta = tx.meta;
  if (!meta || meta.err) return [];
  const keys = tx.transaction.message.accountKeys;
  const byIndex = new Map<number, { pre: bigint; post: bigint; owner: string }>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.mint !== MINT) continue;
    byIndex.set(b.accountIndex, { pre: BigInt(b.uiTokenAmount.amount), post: 0n, owner: b.owner ?? "?" });
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.mint !== MINT) continue;
    const cur = byIndex.get(b.accountIndex) ?? { pre: 0n, post: 0n, owner: b.owner ?? "?" };
    cur.post = BigInt(b.uiTokenAmount.amount);
    cur.owner = b.owner ?? cur.owner;
    byIndex.set(b.accountIndex, cur);
  }
  const out: Delta[] = [];
  for (const [i, v] of byIndex) {
    const d = v.post - v.pre;
    if (d !== 0n) out.push({ owner: v.owner, account: keys[i]?.pubkey.toBase58() ?? `#${i}`, delta: d });
  }
  return out;
}

async function main() {
  const started = Date.now();
  console.log(`mint ${MINT} via ${RPC}`);
  const sigs = await walkSignatures();
  if (sigs.length === 0) throw new Error("no signatures for this mint");

  const balByAccount = new Map<string, bigint>();
  const ownerOf = new Map<string, string>();
  let txs = 0, failed = 0, missing = 0, deltas = 0;
  for (let i = 0; i < sigs.length; i += BATCH) {
    const chunk = sigs.slice(i, i + BATCH).map((s) => s.signature);
    const parsed = await withRetry(() => connection.getParsedTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }), "getParsedTransactions");
    for (const tx of parsed) {
      if (!tx) { missing++; continue; }
      txs++;
      if (tx.meta?.err) { failed++; continue; }
      for (const d of deltasOf(tx)) {
        deltas++;
        balByAccount.set(d.account, (balByAccount.get(d.account) ?? 0n) + d.delta);
        ownerOf.set(d.account, d.owner);
      }
    }
    process.stdout.write(`  txs ${txs}/${sigs.length} (failed ${failed}, missing ${missing}, deltas ${deltas}, 429s ${rateLimited})\r`);
    await sleep(SLEEP_MS);
  }
  console.log();

  // Reconcile against the chain: every rebuilt token account's live amount + total supply.
  // (getTokenLargestAccounts is throttled hard on the public RPC; getMultipleParsedAccounts is not.)
  await sleep(1500);
  const supply = await withRetry(() => connection.getTokenSupply(mint, "confirmed"), "getTokenSupply");
  let rebuiltTotal = 0n;
  for (const v of balByAccount.values()) rebuiltTotal += v;
  const accounts = [...balByAccount.keys()].filter((a) => !a.startsWith("#"));
  let mismatches = 0, checked = 0, closed = 0;
  for (let i = 0; i < accounts.length; i += 100) {
    await sleep(1500);
    const chunk = accounts.slice(i, i + 100);
    const infos = await withRetry(() => connection.getMultipleParsedAccounts(chunk.map((a) => new PublicKey(a)), { commitment: "confirmed" }), "getMultipleParsedAccounts");
    infos.value.forEach((info, j) => {
      const addr = chunk[j];
      const rebuilt = balByAccount.get(addr) ?? 0n;
      const data = info?.data as { parsed?: { info?: { tokenAmount?: { amount: string } } } } | undefined;
      const amount = data?.parsed?.info?.tokenAmount?.amount;
      if (amount === undefined) { closed++; if (rebuilt !== 0n) { mismatches++; console.log(`  MISMATCH ${addr} closed on chain but rebuilt=${rebuilt}`); } return; }
      checked++;
      if (BigInt(amount) !== rebuilt) { mismatches++; console.log(`  MISMATCH ${addr} owner=${ownerOf.get(addr)} rebuilt=${rebuilt} chain=${amount}`); }
    });
  }
  const holders = [...balByAccount.entries()].filter(([, v]) => v > 0n).length;
  console.log(`rebuilt ${balByAccount.size} token accounts (${holders} non-zero) from ${deltas} balance changes in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`rebuilt total ${rebuiltTotal} vs supply ${supply.value.amount} → ${rebuiltTotal === BigInt(supply.value.amount) ? "equal ✓" : "DIFFERENT ✗ (history incomplete or mint/burn outside transfers)"}`);
  console.log(`accounts: ${checked} live checked, ${closed} closed, ${mismatches === 0 ? "all match ✓" : `${mismatches} mismatches ✗`}; RPC 429s: ${rateLimited}`);
  console.log(`${mismatches === 0 && rebuiltTotal === BigInt(supply.value.amount) ? "PASS" : "FAIL"}`);
}

main().catch((e) => { console.error("spike failed:", e); process.exit(1); });
