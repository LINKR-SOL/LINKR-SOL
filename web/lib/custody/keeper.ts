import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Keypair,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createMintToInstruction, createTransferCheckedInstruction, getAccount } from "@solana/spl-token";
import { claimCreatorFee } from "@raydium-io/raydium-sdk-v2";
import { activeCluster, VAULT_PROGRAM_KEY } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { keeperKeypair } from "../solana/keeper";
import { ata } from "../solana/program";
import { sendKeeperTx } from "../solana/send";
import { LAUNCHLAB_PROGRAM_ID, WSOL_MINT } from "../launchlab/ids";
import { creatorFeeVault, creatorFeeVaultAuth, fetchLaunchpadPoolFor } from "../launchlab/pool";
import { swapInstructions } from "../jupiter/client";
import { collections, ensureIndexes } from "../db/collections";
import type { EpochLeafDoc, VaultDoc } from "../db/types";
import { quoteSizedHarvest, swapMode } from "../dividends/quote";
import { reviewWindowFor } from "../launch/options";
import { getPricesFor } from "../xstocks/prices";
import { formatUnits, parseUnits } from "../format";
import { buildEpoch, persistEpoch } from "../indexer/epochBuild";
import { refreshLaunches } from "../indexer/refresh";
import { syncAllBalanceStreams } from "../indexer/balances";
import { acquireLease, autoClaimPolicy, releaseLease, type DividendKeeperReport } from "../indexer/dividendKeeper";
import { custodialConfig } from "./config";
import { vaultKeypair } from "./keys";
import { bindCustodialVault, closeCustodialEpoch, publishCustodialEpoch, recordDelivery, recordHarvest, recordSwap } from "./ledger";

/**
 * The keeper in custodial mode. Same steps as the program keeper (bind → streams → harvest → swap → publish →
 * expire → deliver), but every vault is a keypair the keeper holds, so the "instructions" are plain transfers
 * and swaps signed by the vault, and the accounting is written to Mongo (see ledger.ts) instead of read back
 * from program events. Each published payout's root is still written on-chain, as a memo, so anyone can pin
 * the report to a timestamp and a signature.
 *
 * Fees arrive in the coin's quote token, two ways: StonkFun's sweeper forwards the creator's share as a token
 * transfer into the vault's quote token account (wrapped SOL for SOL-quoted coins, batched every hour or two —
 * the wizard opens that account at launch and the keeper unwraps it), and a platform that pays LaunchLab's on-chain
 * creator fee (LINKR's own devnet platform) accrues it in a fee vault the vault claims. Both end up as "idle"
 * quote on the vault, which is what a harvest converts.
 */

const cluster = activeCluster;
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/** Payouts one delivery sums per holder: every stock goes out as one transfer however many payouts it covers. */
const LEAVES_PER_DELIVERY = 24;
/** Stocks per delivery transaction: an account and a transfer per stock, which keeps it under the 1232-byte limit. */
const STOCKS_PER_TX = 5;
const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

async function tokenBalance(mintAta: PublicKey, tokenProgram: PublicKey): Promise<bigint> {
  const connection = serverConnection();
  return getAccount(connection, mintAta, "confirmed", tokenProgram)
    .then((a) => a.amount)
    .catch(() => 0n);
}

/** Lamports a vault wallet must keep so it exists: the rent-exempt minimum of an empty account. */
export async function vaultFloorLamports(): Promise<number> {
  return serverConnection().getMinimumBalanceForRentExemption(0);
}

export async function runCustodialKeeper(opts: { budgetMs?: number } = {}): Promise<DividendKeeperReport> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  const report: DividendKeeperReport = {
    enabled: false, vaults: 0, bound: [], streams: [], harvested: [], published: [], expired: [], delivered: [], skipped: [], ms: 0,
  };
  const keeper = keeperKeypair();
  if (!keeper) return { ...report, reason: "KEEPER_PRIVATE_KEY not set", ms: Date.now() - started };
  await ensureIndexes();
  const c = await collections();
  const owner = `${keeper.publicKey.toBase58()}:${started}`;
  if (!(await acquireLease(owner, budgetMs + 30_000))) {
    return { ...report, reason: "another keeper run holds the lease", ms: Date.now() - started };
  }
  report.enabled = true;
  report.operator = keeper.publicKey.toBase58();
  const remaining = () => budgetMs - (Date.now() - started);
  const cfg = custodialConfig();
  const connection = serverConnection();

  // the keeper pays every fee and every holder's first token account; empty, each step fails on its own and quietly
  const lamports = await connection.getBalance(keeper.publicKey, "confirmed").catch(() => null);
  if (lamports !== null && lamports < envNumber("KEEPER_LOW_SOL", 0.05) * LAMPORTS_PER_SOL) {
    const reason = `keeper wallet ${keeper.publicKey.toBase58()} holds ${lamports / LAMPORTS_PER_SOL} SOL: fund it or harvests, payouts and airdrops fail`;
    console.error(`[keeper] ${reason}`);
    report.skipped.push({ vault: "*", step: "keeper", reason });
  }

  try {
    const vaults = await c.vaults.find({ cluster, programId: VAULT_PROGRAM_KEY }).toArray();
    report.vaults = vaults.length;

    // 1. bind: the coin a pending vault was created for has launched with the vault as creator
    for (const v of vaults.filter((x) => x.status === "pending")) {
      if (remaining() < 10_000) break;
      try {
        const pool = await fetchLaunchpadPoolFor(connection, new PublicKey(v.expectedMint), new PublicKey(v.quoteMint)).catch(() => null);
        if (!pool || pool.creator !== v.address) continue;
        const boundAt = Math.floor(Date.now() / 1000);
        await bindCustodialVault(v.address, v.expectedMint, boundAt);
        await refreshLaunches([v.expectedMint]).catch(() => {});
        report.bound.push({ vault: v.address, mint: v.expectedMint, signature: "" });
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "bind", reason: short(e) });
      }
    }

    // 2. balance streams
    report.streams = await syncAllBalanceStreams(Math.min(Math.max(remaining() / 2, 5_000), 90_000));

    if (cfg.paused) {
      report.skipped.push({ vault: "*", step: "paused", reason: "VAULT_PAUSED=1" });
      return report;
    }

    const active = (await c.vaults.find({ cluster, programId: VAULT_PROGRAM_KEY, status: "active" }).toArray()).filter((v) => v.launchMint);
    const now = Math.floor(Date.now() / 1000);
    for (const v of active) {
      if (remaining() < 30_000) break;
      // 3. harvest + swaps
      try {
        const h = await harvestVault(v, keeper, { minHarvest: parseUnits(process.env.DIVIDEND_MIN_HARVEST ?? "0.001", v.quoteDecimals ?? 9) });
        if (h) report.harvested.push(h);
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "harvest", reason: short(e) });
      }
      try {
        const swaps = await swapVault(await reload(v.address), keeper, remaining);
        if (swaps.length) {
          const h = report.harvested.find((x) => x.vault === v.address) ?? report.harvested[report.harvested.push({ vault: v.address, input: "0", signature: swaps[0].signature, swaps: [] }) - 1];
          h.swaps.push(...swaps);
        }
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "swap", reason: short(e) });
      }
      // 4. publish
      try {
        if (remaining() < 30_000) break;
        const res = await publishVault(await reload(v.address), keeper, now);
        if (res.kind === "published") report.published.push({ vault: v.address, epochId: res.epochId, holders: res.holders, signature: res.signature });
        else if (res.kind === "skipped") report.skipped.push({ vault: v.address, step: "epoch", reason: res.reason });
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "epoch", reason: short(e) });
      }
      // 5. expire
      try {
        const stale = await c.epochs.find({ cluster, vault: v.address, status: "published", claimableAt: { $ne: null, $lt: now - cfg.claimWindow } }).toArray();
        for (const e of stale) {
          await closeCustodialEpoch(v.address, e.epochId, "expired", null);
          report.expired.push({ vault: v.address, epochId: e.epochId, signature: "" });
        }
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "expire", reason: short(e) });
      }
      // 6. airdrop: every holder's stocks go out as soon as a payout clears its review window
      try {
        const fresh = await reload(v.address);
        const delivered = await deliverVault(fresh, keeper, now, { auto: true, remaining });
        report.delivered.push(...delivered.delivered);
        report.skipped.push(...delivered.skipped);
      } catch (e) {
        report.skipped.push({ vault: v.address, step: "deliver", reason: short(e) });
      }
    }
    return report;
  } finally {
    await releaseLease(owner).catch(() => {});
    report.ms = Date.now() - started;
  }

  async function reload(address: string): Promise<VaultDoc> {
    return (await c.vaults.findOne({ _id: `${cluster}:${address}` }))!;
  }
}

// -------------------------------------------------------------------------------------------------------------

interface QuoteView {
  mint: PublicKey;
  program: PublicKey;
  decimals: number;
  isSol: boolean;
  /** the vault's token account of the quote (for SOL: a WSOL account that only exists during a claim) */
  ata: PublicKey;
}

function quoteOf(v: VaultDoc, vaultPk: PublicKey): QuoteView {
  const mint = new PublicKey(v.quoteMint);
  const program = new PublicKey(v.quoteTokenProgram ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  return { mint, program, decimals: v.quoteDecimals ?? 9, isSol: mint.equals(WSOL_MINT), ata: ata(vaultPk, mint, program) };
}

/**
 * Quote on the vault that no ledger entry accounts for yet — forwarded fees waiting to be harvested. SOL vaults:
 * lamports above the rent floor plus whatever sits in the vault's wrapped-SOL account (StonkFun forwards the
 * creator's share as a token transfer into the creator's quote account, WSOL included); token vaults: the quote
 * token account. Minus what is reserved for pending swaps and the pot of any leg that is the quote itself.
 */
export async function idleQuoteOf(v: VaultDoc, vaultPk: PublicKey, q: QuoteView, floor: bigint): Promise<bigint> {
  const connection = serverConnection();
  let accounted = (v.pendingSwap ?? []).reduce((s, x) => s + BigInt(x || "0"), 0n);
  v.basket.forEach((leg, i) => {
    if (leg.mint === v.quoteMint) accounted += BigInt(v.unallocated?.[i] ?? "0") + BigInt(v.allocated?.[i] ?? "0");
  });
  if (q.isSol) {
    const lamports = BigInt(await connection.getBalance(vaultPk, "confirmed")) + (await tokenBalance(q.ata, q.program));
    return lamports > floor + accounted ? lamports - floor - accounted : 0n;
  }
  const held = await tokenBalance(q.ata, q.program);
  return held > accounted ? held - accounted : 0n;
}

/**
 * SOL vaults: moves whatever StonkFun forwarded into the vault's wrapped-SOL account onto the wallet as plain
 * lamports (close, then re-open the account with the vault's own rent so the balance changes by exactly the
 * wrapped amount). Everything downstream — protocol cut, Jupiter with wrapping — works in lamports.
 */
async function unwrapForwardedSol(v: VaultDoc, keeper: Keypair, vaultKp: Keypair, q: QuoteView): Promise<{ signature: string; slot: number } | null> {
  const connection = serverConnection();
  const wrapped = await tokenBalance(q.ata, q.program);
  if (wrapped === 0n) return null;
  const ixs: TransactionInstruction[] = [
    createCloseAccountInstruction(q.ata, vaultKp.publicKey, vaultKp.publicKey, [], q.program),
    createAssociatedTokenAccountIdempotentInstruction(vaultKp.publicKey, q.ata, vaultKp.publicKey, q.mint, q.program),
  ];
  return sendKeeperTx(connection, keeper, ixs, { extraSigners: [vaultKp], computeUnits: 100_000 });
}

/** Creator fees → the vault wallet → protocol cut out → the rest reserved per leg (in the quote, on the wallet). */
export async function harvestVault(v: VaultDoc, keeper: Keypair, opts: { minHarvest: bigint; force?: boolean }): Promise<DividendKeeperReport["harvested"][number] | null> {
  const connection = serverConnection();
  const cfg = custodialConfig();
  const vaultKp = vaultKeypair(v.creator, v.salt);
  const vaultPk = vaultKp.publicKey;
  if (vaultPk.toBase58() !== v.address) throw new Error("vault key mismatch: KEEPER_PRIVATE_KEY differs from the one that created this vault");
  const q = quoteOf(v, vaultPk);
  const floor = BigInt(await vaultFloorLamports());
  // LaunchLab's on-chain creator fee, when the platform pays one (StonkFun's pays 0 and forwards off-chain instead)
  const accrued = await tokenBalance(creatorFeeVault(vaultPk, q.mint), q.program);
  let idle = await idleQuoteOf(v, vaultPk, q, floor);
  if (accrued + idle < opts.minHarvest && !opts.force) return null;
  if (accrued + idle === 0n) return null;

  let signature = "";
  let slot = 0;
  if (accrued > 0n) {
    // claim into the vault's quote account, signed by the vault; SOL is unwrapped straight back onto the wallet
    const ixs: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, q.ata, vaultPk, q.mint, q.program),
      claimCreatorFee(LAUNCHLAB_PROGRAM_ID, vaultPk, creatorFeeVaultAuth(), creatorFeeVault(vaultPk, q.mint), q.ata, q.mint, q.program),
    ];
    if (q.isSol) {
      // closing the wrapped-SOL account sends its rent to the vault along with the fee; that rent was the keeper's,
      // so it goes straight back — otherwise it would be harvested as if it were a fee
      const existed = await connection.getAccountInfo(q.ata, "confirmed");
      ixs.push(createCloseAccountInstruction(q.ata, vaultPk, vaultPk, [], q.program));
      if (!existed) ixs.push(SystemProgram.transfer({ fromPubkey: vaultPk, toPubkey: keeper.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(165) }));
      else ixs.push(createAssociatedTokenAccountIdempotentInstruction(vaultPk, q.ata, vaultPk, q.mint, q.program));
    }
    const r = await sendKeeperTx(connection, keeper, ixs, { extraSigners: [vaultKp], computeUnits: 200_000 });
    signature = r.signature;
    slot = r.slot;
    idle = await idleQuoteOf(v, vaultPk, q, floor);
  }
  if (q.isSol) {
    const r = await unwrapForwardedSol(v, keeper, vaultKp, q);
    if (r) {
      signature = r.signature;
      slot = r.slot;
      idle = await idleQuoteOf(v, vaultPk, q, floor);
    }
  }
  const input = idle;
  if (input === 0n) return null;
  const cut = (input * BigInt(cfg.protocolShareBps)) / 10_000n;
  const net = input - cut;
  const n = v.basket.length;
  const legInputs: bigint[] = [];
  let spent = 0n;
  v.basket.forEach((leg, i) => {
    const x = i === n - 1 ? net - spent : (net * BigInt(leg.weightBps)) / 10_000n;
    spent += x;
    legInputs.push(x);
  });
  if (cut > 0n) {
    const recipient = new PublicKey(cfg.protocolRecipient);
    const ixs: TransactionInstruction[] = q.isSol
      ? [SystemProgram.transfer({ fromPubkey: vaultPk, toPubkey: recipient, lamports: cut })]
      : [
          createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, ata(recipient, q.mint, q.program), recipient, q.mint, q.program),
          createTransferCheckedInstruction(q.ata, q.mint, ata(recipient, q.mint, q.program), vaultPk, cut, q.decimals, [], q.program),
        ];
    const r = await sendKeeperTx(connection, keeper, ixs, { extraSigners: [vaultKp], computeUnits: 80_000 });
    signature = r.signature;
    slot = r.slot;
  }
  if (!signature) {
    // fees that were already sitting on the wallet (StonkFun's forwarding, or a devnet "credit vault" transfer): note the harvest with a memo
    const r = await sendKeeperTx(connection, keeper, [memoIx(`causa:v1:harvest:${v.address}:${input}`)], { computeUnits: 100_000 });
    signature = r.signature;
    slot = r.slot;
  }
  await recordHarvest(v.address, { caller: keeper.publicKey.toBase58(), input, protocolCut: cut, legInputs, signature, slot });
  return { vault: v.address, input: formatUnits(input, q.decimals), signature, swaps: [] };
}

/** Every leg with quote reserved: swap it (Jupiter, signed by the vault) or mint the mock output on devnet. */
export async function swapVault(v: VaultDoc, keeper: Keypair, remaining: () => number): Promise<{ leg: number; out: string; signature: string }[]> {
  const out: { leg: number; out: string; signature: string }[] = [];
  if (swapMode() === "off") return out;
  const connection = serverConnection();
  const vaultKp = vaultKeypair(v.creator, v.salt);
  const vaultPk = vaultKp.publicKey;
  const q = quoteOf(v, vaultPk);
  const slippageBps = envNumber("DIVIDEND_MAX_SLIPPAGE_BPS", 100);
  // quote the ledger holds on the vault for other purposes: the legs still to swap and any leg that is the quote itself
  const pendingLeft = v.basket.map((_, i) => BigInt(v.pendingSwap?.[i] ?? "0"));
  const quoteLegs = v.basket.reduce((s, b, i) => (b.mint === v.quoteMint ? s + BigInt(v.unallocated?.[i] ?? "0") + BigInt(v.allocated?.[i] ?? "0") : s), 0n);
  for (let leg = 0; leg < v.basket.length; leg++) {
    const l = v.basket[leg];
    const pending = BigInt(v.pendingSwap?.[leg] ?? "0");
    if (pending === 0n || l.mint === v.quoteMint) continue;
    if (remaining() < 30_000) break;
    const mint = new PublicKey(l.mint);
    const tokenProgram = new PublicKey(l.tokenProgram);
    const legAta = ata(vaultPk, mint, tokenProgram);
    const { quote } = await quoteSizedHarvest({
      quoteMint: v.quoteMint, gross: pending, basket: [{ mint: l.mint, weightBps: 10_000 }], protocolShareBps: 0, slippageBps, floor: 1n,
    });
    const ql = quote.legs[0];
    if (ql.amountIn !== pending) throw new Error(`leg ${leg}: venue only absorbs ${ql.amountIn} of ${pending}; waiting`);
    const before = await tokenBalance(legAta, tokenProgram);
    const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, legAta, vaultPk, mint, tokenProgram)];
    let lookupTables: AddressLookupTableAccount[] = [];
    if (swapMode() === "mock") {
      // devnet: the keeper is the mock stock's mint authority; the quote leaves the vault as it would in a real swap
      ixs.push(createMintToInstruction(mint, legAta, keeper.publicKey, ql.quote, [], tokenProgram));
      if (q.isSol) ixs.push(SystemProgram.transfer({ fromPubkey: vaultPk, toPubkey: keeper.publicKey, lamports: ql.amountIn }));
      else {
        const keeperAta = ata(keeper.publicKey, q.mint, q.program);
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, keeperAta, keeper.publicKey, q.mint, q.program));
        ixs.push(createTransferCheckedInstruction(q.ata, q.mint, keeperAta, vaultPk, ql.amountIn, q.decimals, [], q.program));
      }
    } else {
      // SOL-quoted vaults pay from native SOL, so Jupiter wraps for them; a token quote is spent from the vault's token account
      const sw = await swapInstructions(connection, ql.jupiter!, { userPublicKey: vaultPk, destinationTokenAccount: legAta, wrapAndUnwrapSol: q.isSol });
      ixs.push(...sw.instructions);
      if (sw.cleanup) ixs.push(sw.cleanup);
      lookupTables = sw.lookupTables;
      const reservedAfter = quoteLegs + pendingLeft.reduce((s, x) => s + x, 0n) - pending;
      const floated = await withSwapFloat(keeper.publicKey, vaultPk, ixs, lookupTables, { amountIn: pending, isSol: q.isSol, reservedAfter });
      ixs.splice(0, ixs.length, ...floated.instructions);
    }
    const { signature, slot } = await sendKeeperTx(connection, keeper, ixs, { extraSigners: [vaultKp], lookupTables, computeUnits: 1_000_000 });
    pendingLeft[leg] = 0n;
    const after = await tokenBalance(legAta, tokenProgram);
    const got = after > before ? after - before : 0n;
    await recordSwap(v.address, { leg, amountIn: ql.amountIn, amountOut: got, signature, slot });
    out.push({ leg, out: got.toString(), signature });
  }
  return out;
}

/**
 * A Jupiter route can open accounts on the way (an intermediate token account, a venue's own per-user account) and
 * bills their rent to the vault, out of SOL the ledger reserved for other legs. That once left a vault 0.0124 SOL
 * short of its last swap. So the keeper lends the vault a float for the length of the swap and, in the same
 * transaction, takes back all of it except what keeps the vault whole: at least its balance less the swap, and never
 * below its rent floor plus the reserves still on it. The keeper pays for the route, as it pays for holders' token
 * accounts, and a vault an earlier route left short is topped back up. `keeperCost` is what it pays.
 */
export async function withSwapFloat(
  keeper: PublicKey,
  vault: PublicKey,
  swap: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[],
  o: { amountIn: bigint; isSol: boolean; reservedAfter: bigint },
): Promise<{ instructions: TransactionInstruction[]; keeperCost: bigint }> {
  const connection = serverConnection();
  const float = BigInt(Math.round(envNumber("KEEPER_SWAP_FLOAT_SOL", 0.05) * LAMPORTS_PER_SOL));
  const floor = BigInt(await vaultFloorLamports());
  const pre = BigInt(await connection.getBalance(vault, "confirmed"));
  const lend = SystemProgram.transfer({ fromPubkey: keeper, toPubkey: vault, lamports: float });
  const simulated = await lamportsAfter(keeper, [lend, ...swap], lookupTables, vault);
  const unaided = simulated - float;
  // a SOL vault spends exactly amountIn of its lamports; a token-quoted one spends none
  const owed = [unaided, o.isSol ? pre - o.amountIn : pre, floor + (o.isSol ? o.reservedAfter : 0n)].reduce((a, b) => (a > b ? a : b));
  const back = simulated - owed;
  if (back < 0n) throw new Error(`the swap needs ${float - back} lamports from the keeper, more than its ${float} float (KEEPER_SWAP_FLOAT_SOL)`);
  const instructions = [lend, ...swap];
  if (back > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: vault, toPubkey: keeper, lamports: back }));
  return { instructions, keeperCost: float - back };
}

/** Simulates `ixs` with `payer` paying and returns `account`'s lamports afterwards. */
async function lamportsAfter(payer: PublicKey, ixs: TransactionInstruction[], lookupTables: AddressLookupTableAccount[], account: PublicKey): Promise<bigint> {
  const connection = serverConnection();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs],
  }).compileToV0Message(lookupTables);
  const sim = await connection.simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { addresses: [account.toBase58()], encoding: "base64" },
  });
  if (sim.value.err) throw new Error(`swap simulation failed: ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-2).join(" ")}`.slice(0, 300));
  return BigInt(sim.value.accounts?.[0]?.lamports ?? 0);
}

async function publishVault(
  v: VaultDoc,
  keeper: Keypair,
  now: number,
): Promise<{ kind: "none" } | { kind: "skipped"; reason: string } | { kind: "published"; epochId: number; holders: number; signature: string }> {
  if (v.lastPeriodEnd === null || !v.launchMint) return { kind: "none" };
  const cfg = custodialConfig();
  const epochId = v.epochCount + 1;
  const b = await buildEpoch({
    v, launchMint: v.launchMint, now, periodStart: v.lastPeriodEnd, epochLength: v.epochLength, epochId, address: null,
    unallocated: v.basket.map((_, i) => BigInt(v.unallocated?.[i] ?? "0")), mints: v.basket.map((x) => x.mint),
  });
  if (b.kind !== "built") return b;
  await persistEpoch(b, v.launchMint);
  // the root goes on-chain as a memo: a public, timestamped commitment anyone can check the leaves against
  const connection = serverConnection();
  const { signature, slot } = await sendKeeperTx(
    connection,
    keeper,
    [memoIx(`causa:v1:epoch:${v.address}:${epochId}:${b.root}:${v.lastPeriodEnd}-${b.periodEnd}:${b.holders}`)],
    { computeUnits: 100_000 },
  );
  await publishCustodialEpoch(v.address, { epochId, amounts: b.amounts, periodEnd: b.periodEnd, claimableAt: now + reviewWindowFor(v.epochLength, cfg.disputeWindow), signature, slot });
  return { kind: "published", epochId, holders: b.holders, signature };
}

/**
 * Airdrops holders their stocks: transfers from the vault's token accounts, signed by the vault, with holder token
 * accounts created by the keeper when missing. Everything a holder is owed across open payouts goes out as one
 * transfer per stock, in transactions of up to STOCKS_PER_TX stocks; a leaf records the legs it has received, so a
 * delivery cut short resumes without paying a leg twice. `auto` follows the operator policy (delay, minimum value);
 * leaves a holder asked for (`deliverRequestedAt`, the site's Claim button) go regardless, and `only` restricts to
 * one holder.
 */
export async function deliverVault(
  v: VaultDoc,
  keeper: Keypair,
  now: number,
  opts: { auto: boolean; only?: string; remaining?: () => number },
): Promise<{ delivered: DividendKeeperReport["delivered"]; skipped: DividendKeeperReport["skipped"] }> {
  const c = await collections();
  const connection = serverConnection();
  const policy = autoClaimPolicy();
  const delivered: DividendKeeperReport["delivered"] = [];
  const skipped: DividendKeeperReport["skipped"] = [];
  const epochs = await c.epochs.find({ cluster, vault: v.address, status: "published", claimableAt: { $ne: null, $lte: now } }).toArray();
  if (epochs.length === 0) return { delivered, skipped };
  const retryBefore = new Date((now - policy.retrySeconds) * 1000);
  const leaves = await c.epochLeaves
    .find({
      cluster, vault: v.address, epochId: { $in: epochs.map((e) => e.epochId) }, claimed: false,
      ...(opts.only ? { account: opts.only } : {}),
      $or: [{ pushAttemptAt: null }, { pushAttemptAt: { $exists: false } }, { pushAttemptAt: { $lte: retryBefore } }],
    })
    .sort({ epochId: 1 })
    .toArray();
  if (leaves.length === 0) return { delivered, skipped };
  const epochById = new Map(epochs.map((e) => [e.epochId, e]));
  const requested = (l: EpochLeafDoc) => !!(l as EpochLeafDoc & { deliverRequestedAt?: Date | null }).deliverRequestedAt || l.account === opts.only;
  const eligible = leaves.filter((l) => {
    if (requested(l)) return true;
    if (!opts.auto || !policy.enabled) return false;
    const e = epochById.get(l.epochId)!;
    return e.claimableAt !== null && e.claimableAt + policy.delaySeconds <= now;
  });
  const byAccount = new Map<string, EpochLeafDoc[]>();
  for (const l of eligible) byAccount.set(l.account, [...(byAccount.get(l.account) ?? []), l]);
  const prices = await tokenPrices(v.basket.map((b) => b.mint));
  const vaultKp = vaultKeypair(v.creator, v.salt);
  const vaultPk = vaultKp.publicKey;
  /** what a leaf still owes on a leg */
  const owes = (l: EpochLeafDoc, i: number) => (l.sentLegs?.includes(i) ? 0n : BigInt(l.amounts[i] ?? "0"));
  let sent = 0;
  for (const [holder, mine] of byAccount) {
    if (sent >= policy.maxPerRun || (opts.remaining && opts.remaining() < 20_000)) break;
    const batch = mine.slice(0, LEAVES_PER_DELIVERY);
    const totals = v.basket.map((_, i) => batch.reduce((s, l) => s + owes(l, i), 0n));
    const explicit = batch.some(requested);
    if (!explicit && policy.minUsd > 0) {
      // small shares wait and add up until they are worth a transaction (and the holder's token account rent). The
      // check needs a price for every stock owed: an unpriced stock (a price API outage, an illiquid xStock) never
      // holds an airdrop back, it goes out unchecked.
      const owed = v.basket.flatMap((b, i) => (totals[i] > 0n ? [{ b, amount: totals[i] }] : []));
      if (owed.length && owed.every((x) => prices.has(x.b.mint))) {
        const usd = owed.reduce((sum, x) => sum + Number(formatUnits(x.amount, x.b.decimals)) * prices.get(x.b.mint)!, 0);
        if (usd < policy.minUsd) continue;
      }
    }
    const account = new PublicKey(holder);
    const leafIds = batch.map((l) => l._id);
    await c.epochLeaves.updateMany({ _id: { $in: leafIds } }, { $set: { pushAttemptAt: new Date(), pushError: null } });
    const legs = totals.map((t, i) => (t > 0n ? i : -1)).filter((i) => i >= 0);
    let last = "";
    try {
      for (let k = 0; k < legs.length; k += STOCKS_PER_TX) {
        const chunk = legs.slice(k, k + STOCKS_PER_TX);
        const ixs: TransactionInstruction[] = [];
        for (const i of chunk) {
          const b = v.basket[i];
          const mint = new PublicKey(b.mint);
          const tokenProgram = new PublicKey(b.tokenProgram);
          const holderAta = ata(account, mint, tokenProgram);
          ixs.push(createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, holderAta, account, mint, tokenProgram));
          ixs.push(createTransferCheckedInstruction(ata(vaultPk, mint, tokenProgram), mint, holderAta, vaultPk, totals[i], b.decimals, [], tokenProgram));
        }
        const { signature, slot } = await sendKeeperTx(connection, keeper, ixs, { extraSigners: [vaultKp], computeUnits: 60_000 + chunk.length * 40_000 });
        last = signature;
        for (let j = 0; j < batch.length; j++) {
          const leaf = batch[j];
          const legsHere = chunk.filter((i) => owes(leaf, i) > 0n);
          if (legsHere.length === 0) continue;
          await recordDelivery(v.address, { epochId: leaf.epochId, account: holder, amounts: leaf.amounts.map(BigInt), legs: legsHere, signature, slot, ixIndex: j });
          leaf.sentLegs = [...(leaf.sentLegs ?? []), ...legsHere];
        }
      }
      delivered.push({ vault: v.address, account: holder, epochs: batch.map((l) => l.epochId), signature: last });
      sent++;
    } catch (e) {
      const msg = short(e);
      await c.epochLeaves.updateMany({ _id: { $in: leafIds } }, { $set: { pushError: msg } });
      skipped.push({ vault: v.address, step: "deliver", reason: `${holder}: ${msg}` });
    }
  }
  return { delivered, skipped };

  /** Live USD prices (the same Jupiter feed the site shows), with any price stored on the token as a fallback. */
  async function tokenPrices(mints: string[]): Promise<Map<string, number>> {
    const out = await getPricesFor(mints).catch(() => new Map<string, number>());
    const docs = await c.tokens.find({ _id: { $in: mints.filter((m) => !out.has(m)).map((m) => `${cluster}:${m}`) } }, { projection: { mint: 1, priceUsd: 1 } }).toArray();
    for (const d of docs) {
      const p = d.priceUsd ? Number(d.priceUsd.toString()) : 0;
      if (p > 0) out.set(d.mint, p);
    }
    return out;
  }
}

// --- on-demand entry points used by the API routes (they take the keeper lease briefly) --------------------

async function withLease<T>(fn: (keeper: Keypair) => Promise<T>): Promise<T> {
  const keeper = keeperKeypair();
  if (!keeper) throw new Error("KEEPER_PRIVATE_KEY not set");
  const owner = `${keeper.publicKey.toBase58()}:api:${Date.now()}`;
  const deadline = Date.now() + 25_000;
  while (!(await acquireLease(owner, 60_000))) {
    if (Date.now() > deadline) throw new Error("the keeper is busy, try again in a minute");
    await new Promise((r) => setTimeout(r, 1_500));
  }
  try {
    return await fn(keeper);
  } finally {
    await releaseLease(owner).catch(() => {});
  }
}

/** The creator's "Harvest now": collect + reserve + swap immediately, ignoring the size threshold. */
export async function harvestNow(address: string): Promise<{ harvested: string | null; swaps: number }> {
  return withLease(async (keeper) => {
    const c = await collections();
    const v = await c.vaults.findOne({ _id: `${cluster}:${address}` });
    if (!v || !v.launchMint) throw new Error("vault is not bound to a launch yet");
    const h = await harvestVault(v, keeper, { minHarvest: 0n, force: true });
    const fresh = (await c.vaults.findOne({ _id: `${cluster}:${address}` }))!;
    const swaps = await swapVault(fresh, keeper, () => 120_000);
    return { harvested: h?.signature ?? null, swaps: swaps.length };
  });
}

/** A holder pressed Claim: deliver every claimable leaf of theirs in this vault right now. */
export async function deliverNow(address: string, account: string): Promise<DividendKeeperReport["delivered"]> {
  return withLease(async (keeper) => {
    const c = await collections();
    const v = await c.vaults.findOne({ _id: `${cluster}:${address}` });
    if (!v) throw new Error("vault not found");
    await c.epochLeaves.updateMany({ cluster, vault: address, account, claimed: false }, { $set: { deliverRequestedAt: new Date(), pushAttemptAt: null } });
    const res = await deliverVault(v, keeper, Math.floor(Date.now() / 1000), { auto: false, only: account });
    if (res.skipped.length && res.delivered.length === 0) throw new Error(res.skipped[0].reason);
    return res.delivered;
  });
}

function memoIx(text: string): TransactionInstruction {
  return new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(text, "utf8") });
}
