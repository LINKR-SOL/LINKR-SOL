/**
 * Nasdaq trade halts RSS — SOURCE_INVENTORY.md §4.1.
 *
 * Structured market evidence rather than reporting: a halt is a hard, timestamped fact
 * about one ticker. The feed's own <title> is just the symbol ("TXXD"), which is useless
 * as a headline, so the story is written from the namespaced ndaq: fields the feed
 * actually carries — symbol, issue name and reason code.
 *
 * It only survives the collector's gates when the halted symbol is a stock that exists on
 * xStocks on Solana: a halt on a company nobody here can pair to is not news for this site.
 */
import { requestFeed } from "../http";
import { parseFeed, tag } from "../xml";
import { type Adapter, type RawStory } from "./types";

const ENDPOINT = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts";
const HALTS_PAGE = "https://www.nasdaqtrader.com/trader.aspx?id=TradeHalts";

/** Nasdaq's published halt reason codes; anything unlisted keeps its raw code. */
const REASONS: Record<string, string> = {
  T1: "news pending",
  T2: "news released",
  T5: "single-stock trading pause on volatility",
  T6: "extraordinary market activity",
  T8: "ETF halt",
  T12: "additional information requested",
  H4: "non-compliance halt",
  H9: "not current in filings",
  H10: "SEC trading suspension",
  LUDP: "volatility trading pause",
  LULD: "limit up / limit down pause",
  M: "volatility trading pause",
  MWC1: "market-wide circuit breaker, level 1",
  MWC2: "market-wide circuit breaker, level 2",
  MWC3: "market-wide circuit breaker, level 3",
  D: "operations halt",
  IPO1: "IPO not yet trading",
};

/** "09/04/2026" + "19:50:00.000" (US Eastern) -> Date. */
function haltTime(date: string | null, time: string | null): Date | null {
  if (!date) return null;
  const d = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!d) return null;
  const t = (time ?? "00:00:00").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  // The feed publishes Eastern wall-clock; treat it as EDT/EST by month, which is close
  // enough for ordering and never fabricates precision the feed does not have.
  const month = Number(d[1]);
  const offset = month >= 3 && month <= 11 ? 4 : 5;
  const at = new Date(
    Date.UTC(Number(d[3]), month - 1, Number(d[2]), (t ? Number(t[1]) : 0) + offset, t ? Number(t[2]) : 0, t?.[3] ? Number(t[3]) : 0),
  );
  return Number.isFinite(at.getTime()) ? at : null;
}

export const nasdaqHalts: Adapter = {
  key: "nasdaq-halts",
  label: "Nasdaq Trade Halts",
  envFlag: "SOURCE_NASDAQ_HALTS",
  defaultOn: true,
  async collect() {
    const xml = await requestFeed(ENDPOINT);
    const out: RawStory[] = [];

    for (const item of parseFeed(xml)) {
      const symbol = tag(item.raw, "ndaq:IssueSymbol")?.trim() || item.title.trim();
      if (!symbol || !/^[A-Z.\-]{1,8}$/.test(symbol)) continue;

      const name = tag(item.raw, "ndaq:IssueName")?.trim() || null;
      const code = tag(item.raw, "ndaq:ReasonCode")?.trim() || "";
      const reason = REASONS[code] ?? (code ? `reason code ${code}` : null);
      const resumption = tag(item.raw, "ndaq:ResumptionTradeTime")?.trim() || null;

      const at = haltTime(tag(item.raw, "ndaq:HaltDate"), tag(item.raw, "ndaq:HaltTime")) ?? item.published;
      if (!at) continue;

      out.push({
        sourceKey: "nasdaq-halts",
        sourceName: "Nasdaq Trader",
        lane: "market",
        tier: 1,
        title: `Trading halted in ${symbol}${reason ? ` — ${reason}` : ""}`,
        summary: [name, code ? `Reason code ${code}.` : null, resumption ? `Resumption quoted for ${resumption}.` : null]
          .filter(Boolean)
          .join(" · ") || null,
        url: HALTS_PAGE,
        imageUrl: null,
        publishedAt: at,
        symbolHints: [symbol],
        signals: { halt: true, reasonCode: code },
      });
    }
    return out;
  },
};
