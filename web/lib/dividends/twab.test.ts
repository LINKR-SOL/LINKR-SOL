import { describe, expect, it } from "vitest";
import { allocate, computeTwab } from "./twab";

const change = (owner: string, delta: bigint, timestamp: number, slot = timestamp, index = 0) => ({ owner, delta, timestamp, slot, index });

describe("time-weighted balances from deltas", () => {
  it("weights by balance × time and ignores excluded owners", () => {
    const r = computeTwab({
      changes: [change("curve", 1_000n, 0), change("curve", -100n, 0, 0, 1), change("alice", 100n, 0, 0, 2), change("alice", -50n, 50, 50), change("bob", 50n, 50, 50, 1)],
      startBalances: [],
      start: 0,
      end: 100,
      excluded: ["curve"],
    });
    // alice: 100 × 50 + 50 × 50 = 7500; bob: 50 × 50 = 2500; curve excluded
    expect(r.acc.get("alice")).toBe(7_500n);
    expect(r.acc.get("bob")).toBe(2_500n);
    expect(r.acc.has("curve")).toBe(false);
    expect(r.sumAcc).toBe(10_000n);
    expect(r.balances.get("curve")).toBe(900n);
    expect(r.replayed).toBe(2);
  });

  it("uses start balances and skips changes outside the period", () => {
    const r = computeTwab({
      changes: [change("alice", 10n, 5), change("alice", 10n, 200)],
      startBalances: [["alice", 100n]],
      start: 10,
      end: 110,
      excluded: [],
    });
    // the t=5 change folds into the starting balance (110), the t=200 change is ignored
    expect(r.acc.get("alice")).toBe(110n * 100n);
    expect(r.balances.get("alice")).toBe(110n);
  });

  it("orders by slot then index", () => {
    const r = computeTwab({
      changes: [change("a", -5n, 20, 20, 1), change("a", 5n, 20, 20, 0)],
      startBalances: [],
      start: 0,
      end: 40,
      excluded: [],
    });
    expect(r.balances.has("a")).toBe(false);
  });

  it("allocates pro rata with flooring residue", () => {
    const acc = new Map([
      ["a", 2n],
      ["b", 1n],
    ]);
    const out = allocate([100n, 7n], acc, 3n);
    expect(out.leaves.map((l) => [l.account, l.amounts])).toEqual([
      ["a", [66n, 4n]],
      ["b", [33n, 2n]],
    ]);
    expect(out.amounts).toEqual([99n, 6n]);
    expect(out.residue).toEqual([1n, 1n]);
  });
});
