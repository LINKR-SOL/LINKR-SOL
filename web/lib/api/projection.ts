/**
 * "What will I get in the next payout?"
 *
 * A payout only becomes visible once the keeper publishes an epoch, which happens once per
 * period — so for most of the day a holder opens /claims and sees nothing, even though stock
 * is piling up in the vault with their name effectively on it. This projects that pile.
 *
 * The estimate is the same arithmetic the keeper will run, stopped early:
 *  1. replay the coin's balance changes from the period start to wherever the stream is
 *     indexed, giving every account its time-weighted balance so far (`computeTwab`);
 *  2. carry that forward to the end of the period assuming balances stay as they are now —
 *     the account's own balance is read live, so a wallet that bought a minute ago still sees
 *     the share it is on track for rather than the zero it has earned so far;
 *  3. split the vault's unallocated basket pro rata to that projected weight.
 *
 * It is an estimate and the UI says so: anyone who buys or sells before the period closes
 * moves everybody's share. Deliberately read-only and best-effort — a projection must never
 * be the reason /claims fails to load.
 */
import { PublicKey } from "@solana/web3.js";
import type { VaultDoc } from "../db/types";
import type { ProjectionJson, VaultJson } from "../api-types";
import { collections } from "../db/collections";
import { activeCluster, isCustodial } from "../solana/cluster";
import { reviewWindowFor } from "../launch/options";
import { serverConnection } from "../solana/connection";
import { configPda, readonlyProgram } from "../solana/program";
import { computeTwab } from "../dividends/twab";
import { excludedOwners } from "../dividends/excluded";
import { usdOf } from "../format";

const cluster = activeCluster;
const TTL = 45_000;

interface PeriodWeights {
  acc: Map<string, bigint>;
  balances: Map<string, bigint>;
  sumAcc: bigint;
  eligibleSupply: bigint;
  holderCount: number;
  periodStart: number;
  periodEnd: number;
  asOf: number;
}

const cache = new Map<string, { at: number; value: PeriodWeights | null }>();

async function periodWeights(v: VaultDoc): Promise<PeriodWeights | null> {
  const hit = cache.get(v.address);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await computePeriod(v).catch(() => null);
  cache.set(v.address, { at: Date.now(), value });
  return value;
}

async function computePeriod(v: VaultDoc): Promise<PeriodWeights | null> {
  if (!v.launchMint || v.lastPeriodEnd === null) return null;
  const c = await collections();
  const mint = v.launchMint;
  const stream = await c.transferStreams.findOne({ _id: `${cluster}:${mint}` });
  if (!stream || stream.cursorTimestamp === null || !stream.backfilled) return null;

  const periodStart = v.lastPeriodEnd;
  // The keeper only publishes when there is something to pay, so a close with no fees rolls into the next
  // window and the vault's period start stays put. The next close is therefore the first period boundary
  // after now, not simply start + length — mirrors `k` in the keeper's publish step.
  const now = Math.floor(Date.now() / 1000);
  const elapsedPeriods = Math.max(0, Math.floor((now - periodStart) / v.epochLength));
  const periodEnd = periodStart + (elapsedPeriods + 1) * v.epochLength;
  const asOf = Math.min(stream.cursorTimestamp, periodEnd);
  if (asOf <= periodStart) return null;

  const snapshot = await c.holderSnapshots.find({ cluster, mint, periodEnd: periodStart }).toArray();
  const fromSlot = snapshot.length ? Math.max(...snapshot.map((h) => h.asOfSlot)) : null;
  const changes = await c.balanceChanges
    .find(fromSlot === null ? { cluster, mint } : { cluster, mint, slot: { $gt: fromSlot } })
    .sort({ slot: 1, index: 1 })
    .toArray();

  const excluded = await excludedOwners(v.address, mint);
  const twab = computeTwab({
    changes: changes.map((t) => ({ owner: t.owner, delta: BigInt(t.delta), timestamp: t.timestamp, slot: t.slot, index: t.index })),
    startBalances: snapshot.map((h) => [h.owner, BigInt(h.balance)] as [string, bigint]),
    start: periodStart,
    end: asOf,
    excluded,
  });

  const balances = new Map<string, bigint>();
  let eligibleSupply = 0n;
  for (const [a, b] of twab.balances) {
    if (excluded.has(a) || b <= 0n) continue;
    balances.set(a, b);
    eligibleSupply += b;
  }
  if (eligibleSupply === 0n) return null;
  return {
    acc: twab.acc,
    balances,
    sumAcc: twab.sumAcc,
    eligibleSupply,
    holderCount: new Set([...twab.acc.keys(), ...balances.keys()]).size,
    periodStart,
    periodEnd,
    asOf,
  };
}

/** Live coin balance of `owner` across all its token accounts for `mint`. */
async function liveBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const connection = serverConnection();
  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed").catch(() => null);
  if (!res) return 0n;
  let total = 0n;
  for (const a of res.value) {
    const amt = (a.account.data as { parsed?: { info?: { tokenAmount?: { amount: string } } } }).parsed?.info?.tokenAmount?.amount;
    if (amt) total += BigInt(amt);
  }
  return total;
}

/**
 * Projected next payout for `account` in every bound vault whose coin it holds.
 * Takes vault documents and a serialiser so only the vaults that survive the balance check
 * pay the cost of being turned into JSON.
 */
/** Seconds the keeper usually needs after a close: one cron tick to notice it plus the publish transaction. */
export const KEEPER_LAG_S = 90;

export async function projectionsFor(account: string, docs: VaultDoc[], toJson: (v: VaultDoc) => Promise<VaultJson>): Promise<ProjectionJson[]> {
  const bound = docs.filter((v) => v.launchMint && v.lastPeriodEnd !== null);
  if (bound.length === 0) return [];
  const owner = new PublicKey(account);
  const maxWindow = isCustodial
    ? (await import("../custody/config")).custodialConfig().disputeWindow
    : ((await readonlyProgram(serverConnection()).account.config.fetchNullable(configPda()).catch(() => null))?.disputeWindow ?? 0);
  const balances = await Promise.all(bound.map((v) => liveBalance(owner, new PublicKey(v.launchMint!))));
  const held = bound.map((doc, i) => ({ doc, balance: balances[i] })).filter((v) => v.balance > 0n);

  const out: ProjectionJson[] = [];
  for (const v of held) {
    const w = await periodWeights(v.doc);
    if (!w) continue;
    const indexedBalance = w.balances.get(account) ?? 0n;
    const remaining = BigInt(Math.max(0, w.periodEnd - w.asOf));
    const supplyAhead = w.eligibleSupply - indexedBalance + v.balance;
    const myWeight = (w.acc.get(account) ?? 0n) + v.balance * remaining;
    const sumWeight = w.sumAcc + supplyAhead * remaining;
    if (sumWeight <= 0n || myWeight <= 0n) continue;

    const json = await toJson(v.doc);
    // custodial payouts wait a review window sized to the period, so they land before the next one ends
    const disputeWindow = isCustodial ? reviewWindowFor(v.doc.epochLength, maxWindow) : maxWindow;
    const amounts = json.basket.map((b) => ((BigInt(b.unallocated) * myWeight) / sumWeight).toString());
    let usd: number | null = null;
    json.basket.forEach((b, i) => {
      const u = usdOf(amounts[i], b.decimals, b.priceUsd);
      if (u !== null) usd = (usd ?? 0) + u;
    });
    out.push({
      vault: json,
      balance: v.balance.toString(),
      sharePpm: Number((myWeight * 1_000_000n) / sumWeight),
      holderCount: w.holderCount + (indexedBalance > 0n ? 0 : 1),
      periodStart: w.periodStart,
      periodEnd: w.periodEnd,
      asOf: w.asOf,
      amounts,
      usd,
      isEstimate: true,
      disputeWindow,
      keeperLag: KEEPER_LAG_S,
      claimableEstimate: w.periodEnd + KEEPER_LAG_S + disputeWindow,
      potEmpty: json.basket.every((b) => BigInt(b.unallocated) === 0n),
    });
  }
  return out;
}
