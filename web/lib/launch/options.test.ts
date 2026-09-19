import { describe, expect, it } from "vitest";
import { MAX_BASKET, basketValid, evenWeights, reviewWindowFor, toWholePercents, withAdded, withRemoved } from "./options";

const sum = (xs: { weight: number }[]) => xs.reduce((s, x) => s + x.weight, 0);
const leg = (id: string, weight = 0) => ({ id, weight });

describe("basket weights (shared by the web wizard and the Telegram bot)", () => {
  it("splits whole percents that always sum to 100, each at least 1", () => {
    for (let n = 1; n <= MAX_BASKET; n++) {
      const w = toWholePercents(Array.from({ length: n }, () => 1));
      expect(w.reduce((s, v) => s + v, 0)).toBe(100);
      expect(w.every((v) => Number.isInteger(v) && v >= 1)).toBe(true);
    }
    expect(toWholePercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("adding a leg scales the others down proportionally", () => {
    let b = withAdded([], leg("a"));
    expect(b).toEqual([{ id: "a", weight: 100 }]);
    b = withAdded(b, leg("b"));
    expect(b.map((x) => x.weight)).toEqual([50, 50]);
    b = withAdded([leg("a", 60), leg("b", 40)], leg("c"));
    expect(sum(b)).toBe(100);
    expect(b[0].weight).toBeGreaterThan(b[1].weight);
  });

  it("removing a leg hands its weight back to the rest", () => {
    const b = withRemoved([leg("a", 60), leg("b", 30), leg("c", 10)], (x) => x.id === "a");
    expect(b.map((x) => x.id)).toEqual(["b", "c"]);
    expect(b.map((x) => x.weight)).toEqual([75, 25]);
    expect(withRemoved([leg("a", 100)], (x) => x.id === "a")).toEqual([]);
  });

  it("even split and validity", () => {
    expect(sum(evenWeights([leg("a", 90), leg("b", 5), leg("c", 5)]))).toBe(100);
    expect(basketValid([60, 40])).toBe(true);
    expect(basketValid([])).toBe(false);
    expect(basketValid([70, 20])).toBe(false);
    expect(basketValid([100, 0])).toBe(false);
    expect(basketValid([50.5, 49.5])).toBe(false);
    expect(basketValid(Array.from({ length: 11 }, (_, i) => (i === 0 ? 90 : 1)))).toBe(false);
  });
});

describe("review window before the airdrop", () => {
  it("is a fifth of the period, capped at the operator's window, never under a minute", () => {
    expect(reviewWindowFor(600, 600)).toBe(120); // 10-minute payouts: 2-minute review
    expect(reviewWindowFor(3_600, 600)).toBe(600); // hourly and longer: the full window
    expect(reviewWindowFor(7 * 86_400, 600)).toBe(600);
    expect(reviewWindowFor(120, 600)).toBe(60); // floor
    expect(reviewWindowFor(600, 0)).toBe(0); // an operator with no review window gets none
  });

  it("always leaves time to publish and deliver inside the next period", () => {
    for (const period of [600, 3_600, 43_200, 86_400]) {
      const keeperLag = 90 + 120; // one cron tick to publish, one to deliver
      expect(reviewWindowFor(period, 600) + keeperLag).toBeLessThan(period);
    }
  });
});
