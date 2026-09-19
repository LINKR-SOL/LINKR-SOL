// Time-weighted average balance (TWAB) over one dividend epoch, computed from per-owner balance changes
// (the signed deltas the indexer derives from pre/post token balances of every transaction touching the mint).
//
// Definitions (all times in unix seconds, period is half-open [start, end)):
//  - a change with timestamp t <= start belongs to the starting balance (no accrual);
//  - a change with start < t < end is replayed: the owner accrues balance * (t - lastTouched) first, then the
//    balance moves;
//  - a change with t >= end belongs to the next epoch and is ignored.
// The weight of an owner is sum(balance_i * duration_i) over the period; excluded owners (the vault, the bonding
// curve, the Raydium pool, ...) keep their balances tracked (they matter for the next snapshot) but never earn
// weight. Pure and bigint-only so the keeper and the audit API share one implementation.

export interface BalanceChangeLike {
  owner: string;
  delta: bigint;
  timestamp: number;
  slot: number;
  index: number;
}

export interface TwabInput {
  changes: BalanceChangeLike[];
  startBalances: Iterable<[string, bigint]>;
  start: number;
  end: number;
  excluded: Iterable<string>;
}

export interface TwabResult {
  /** weight per included owner (balance-seconds), zero weights omitted */
  acc: Map<string, bigint>;
  /** balance of every owner at `end` (zero balances omitted), including excluded owners */
  balances: Map<string, bigint>;
  sumAcc: bigint;
  /** number of changes that fell inside (start, end) */
  replayed: number;
}

export function computeTwab(input: TwabInput): TwabResult {
  const { start, end } = input;
  if (end <= start) throw new Error("twab: end must be after start");
  const excluded = new Set<string>(input.excluded);

  const bal = new Map<string, bigint>();
  for (const [a, v] of input.startBalances) {
    if (v > 0n) bal.set(a, v);
  }
  const acc = new Map<string, bigint>();
  const last = new Map<string, number>();

  const sorted = [...input.changes].sort((a, b) => a.slot - b.slot || a.index - b.index);
  let replayed = 0;
  const accrue = (a: string, t: number) => {
    const b = bal.get(a) ?? 0n;
    const l = last.get(a) ?? start;
    if (b > 0n && t > l) acc.set(a, (acc.get(a) ?? 0n) + b * BigInt(t - l));
    last.set(a, t);
  };
  const apply = (owner: string, delta: bigint) => {
    if (delta === 0n) return;
    const b = (bal.get(owner) ?? 0n) + delta;
    if (b < 0n) throw new Error(`twab: balance of ${owner} would go negative`);
    if (b === 0n) bal.delete(owner);
    else bal.set(owner, b);
  };

  for (const ch of sorted) {
    if (ch.timestamp >= end) continue;
    if (ch.timestamp <= start) {
      apply(ch.owner, ch.delta);
      continue;
    }
    replayed++;
    accrue(ch.owner, ch.timestamp);
    apply(ch.owner, ch.delta);
  }
  // final accrual to `end` for everyone who held anything during the period
  const seen = new Set<string>([...bal.keys(), ...acc.keys(), ...last.keys()]);
  for (const a of seen) accrue(a, end);

  const included = new Map<string, bigint>();
  let sumAcc = 0n;
  for (const [a, w] of acc) {
    if (w <= 0n || excluded.has(a)) continue;
    included.set(a, w);
    sumAcc += w;
  }
  return { acc: included, balances: bal, sumAcc, replayed };
}

export interface Leaf {
  account: string;
  amounts: bigint[];
  /** the account's weight, kept for auditability */
  acc: bigint;
}

export interface Allocation {
  leaves: Leaf[];
  /** per-token sum of the kept leaves (what gets published on-chain) */
  amounts: bigint[];
  /** per-token residue that stays unallocated */
  residue: bigint[];
  dropped: number;
}

/** Splits `totals` (one per epoch token) across accounts pro rata to their weight, flooring per account. */
export function allocate(totals: bigint[], acc: Map<string, bigint>, sumAcc: bigint, minShareBps1e6 = 1n): Allocation {
  const leaves: Leaf[] = [];
  const amounts = totals.map(() => 0n);
  let dropped = 0;
  if (sumAcc > 0n) {
    const accounts = [...acc.keys()].sort();
    for (const a of accounts) {
      const w = acc.get(a)!;
      // drop shares below minShareBps1e6 / 1e6 of the pool (default 0.0001%) and all-zero leaves
      if (w * 1_000_000n < sumAcc * minShareBps1e6) {
        dropped++;
        continue;
      }
      const amt = totals.map((t) => (t * w) / sumAcc);
      if (amt.every((x) => x === 0n)) {
        dropped++;
        continue;
      }
      leaves.push({ account: a, amounts: amt, acc: w });
      amt.forEach((x, i) => (amounts[i] += x));
    }
  }
  return { leaves, amounts, residue: totals.map((t, i) => t - amounts[i]), dropped };
}
