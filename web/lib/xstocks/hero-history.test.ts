import { describe, expect, it } from "vitest";
import { parseHeroCandles } from "./hero-history";
describe("hero history", () => {
  const now = 10 * 86400 * 1000;
  it("sorts completed candles and preserves genuine zero volume", () => {
    expect(parseHeroCandles([[8*86400,1,1,1,20,0],[7*86400,1,1,1,19,120]], now)).toEqual([{t:7*86400,close:19,volume:120},{t:8*86400,close:20,volume:0}]);
  });
  it("excludes current partial day, invalid numbers, non-positive prices and negative volumes", () => {
    expect(parseHeroCandles([[10*86400,1,1,1,20,10],[86400,1,1,1,null,10],[86400,1,1,1,0,10],[86400,1,1,1,20,-1],[86400,1,1,1,NaN,10]], now)).toEqual([]);
  });
  it("deduplicates timestamps and tolerates malformed envelopes", () => {
    expect(parseHeroCandles(null,now)).toEqual([]);
    expect(parseHeroCandles([[86400,1,1,1,20,10],[86400,1,1,1,21,11]],now)).toHaveLength(1);
  });
});
