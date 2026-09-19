/**
 * Market linkage: turning a headline into assets this site can actually pair to.
 *
 * SOURCE_INVENTORY.md §1 makes a concrete market reference a hard requirement for an
 * alert. The web newswire keeps that rule and narrows it: the reference has to resolve to
 * a stock that exists as an xStock on Solana, because those are the only assets a LINKR
 * vault can pay holders in. A story about a company with no xStock is real news and still
 * not news for this site.
 *
 * Matching is deliberately conservative — a false ticker on a headline is worse than a
 * missing one, since the UI prices every ticker it is given:
 *  - `$TSLA` cashtags always count;
 *  - symbols the source itself attached (Stocktwits `symbol_codes`, Yahoo ticker labels) count;
 *  - a bare uppercase ticker counts only at 3+ characters and outside a stop list;
 *  - a company name counts only when it appears capitalised as written, so "Coherent said"
 *    resolves and "a coherent strategy" does not.
 */
import { MAINNET_STOCK_TOKENS } from "../stock-tokens.generated";
import { NARRATIVES } from "../narratives";
import type { NewsCategory } from "./types";

const SYMBOLS = new Set(MAINNET_STOCK_TOKENS.map((t) => t.symbol));

/** Uppercase words that are far more often English, an acronym, or an exchange than the
 *  ticker they collide with. A cashtag or a source-supplied symbol still gets through. */
const BARE_STOPLIST = new Set([
  "ALL", "AND", "ANY", "APP", "ARE", "BIG", "BUY", "CEO", "CFO", "EPS", "ETF", "FED", "FOR", "GDP", "IPO",
  "ITS", "NEW", "NOT", "NOW", "ONE", "OUT", "SEC", "THE", "TOP", "USA", "USD", "WAR", "WHO", "YOU", "CPI",
  "AI", "EV", "IT", "ON", "SO", "UK", "US", "PC", "TV", "UP",
]);

/** Company names that are also ordinary words; only their ticker or a source hint counts. */
const AMBIGUOUS_NAMES = new Set([
  "coherent", "celsius", "unity", "block", "match", "carnival", "bull", "arm", "axon", "opendoor", "root",
  "affirm", "core", "crown", "peak", "under armour", "e", "be", "u", "on",
]);

const CORPORATE_SUFFIX =
  /,?\s+(inc\.?|incorporated|corp\.?|corporation|company|co\.?|holdings?|group|ltd\.?|limited|plc|nv|n\.v\.|sa|s\.a\.|ag|the|class [a-c]|common stock|adr|etf)$/i;

/** "NVIDIA Corp" -> "NVIDIA"; repeated so "Foo Holdings Inc" reduces fully. */
function cleanName(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(CORPORATE_SUFFIX, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

interface NameEntry {
  symbol: string;
  name: string;
  pattern: RegExp;
}

const NAME_ENTRIES: NameEntry[] = MAINNET_STOCK_TOKENS.flatMap((t) => {
  const name = cleanName(t.name);
  if (name.length < 4 || AMBIGUOUS_NAMES.has(name.toLowerCase())) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Case-sensitive: a company name is a proper noun where it is being reported.
  return [{ symbol: t.symbol, name, pattern: new RegExp(`(?<![\\w$])${escaped}(?![\\w])`) }];
});

/**
 * Aliases the inventory calls out by name (§1: Robinhood → $HOOD, Tesla/Elon Musk → $TSLA,
 * Nvidia → $NVDA, Fed → $SPY), plus the people and products that carry a ticker in practice.
 * Keys are matched case-insensitively on word boundaries.
 */
const ALIASES: [string, string][] = [
  ["robinhood", "HOOD"],
  ["robinhood markets", "HOOD"],
  ["elon musk", "TSLA"],
  ["tesla", "TSLA"],
  ["nvidia", "NVDA"],
  ["the fed", "SPY"],
  ["federal reserve", "SPY"],
  ["s&p 500", "SPY"],
  ["jensen huang", "NVDA"],
  ["tim cook", "AAPL"],
  ["iphone", "AAPL"],
  ["openai", "MSFT"],
  ["chatgpt", "MSFT"],
  ["azure", "MSFT"],
  ["google", "GOOGL"],
  ["alphabet", "GOOGL"],
  ["gemini model", "GOOGL"],
  ["facebook", "META"],
  ["instagram", "META"],
  ["whatsapp", "META"],
  ["amazon web services", "AMZN"],
  ["aws", "AMZN"],
  ["coinbase", "COIN"],
  ["microstrategy", "MSTR"],
  ["strategy inc", "MSTR"],
  ["circle internet", "CRCL"],
  ["gamestop", "GME"],
  ["reddit", "RDDT"],
  ["palantir", "PLTR"],
  ["broadcom", "AVGO"],
  ["taiwan semiconductor", "TSM"],
  ["tsmc", "TSM"],
  ["micron", "MU"],
  ["super micro", "SMCI"],
  ["supermicro", "SMCI"],
  ["rocket lab", "RKLB"],
  ["boeing", "BA"],
  ["netflix", "NFLX"],
  ["oracle", "ORCL"],
  ["intel", "INTC"],
  ["applovin", "APP"],
  ["constellation energy", "CEG"],
  ["cleanspark", "CLSK"],
].filter(([, symbol]) => SYMBOLS.has(symbol)) as [string, string][];

/** Alias phrases may carry their own regex tail (a lookahead), so only the literal head
 *  is escaped — everything from the first "(" on is treated as pattern. */
const ALIAS_PATTERNS = ALIASES.map(([phrase, symbol]) => {
  const cut = phrase.indexOf("(?");
  const literal = cut === -1 ? phrase : phrase.slice(0, cut);
  const tail = cut === -1 ? "" : phrase.slice(cut);
  return {
    symbol,
    pattern: new RegExp(`(?<![\\w$])${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${tail}(?![\\w])`, "i"),
  };
});

/** Venue words: a story about the chain or the launchpad itself, which is on-topic here
 *  even when it names no single company. */
const VENUE = {
  chain: /\b(xstocks?|backed finance|tokeni[sz]ed (equit|stock|share)|onchain stock|stock token)/i,
  protocol: /\b(stonk\.?fun|stonkfun|launchlab|raydium|launchpad|bonding curve)\b/i,
  company: /\$causa\b|\bcausa[-\s]?rh\b|\b0xcausa\b|\bcausadotfun\b/i,
};

const CRYPTO =
  /\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|dogecoin|crypto|stablecoin|usdc|usdt|defi|memecoin|blockchain|onchain|digital asset)\b/i;

/** Broad-market proxies. A story whose only linkage is one of these is about the market,
 *  not about a company — "Fed holds rates" resolves to SPY and belongs under Markets. */
const INDEX_PROXIES = new Set(["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "BND", "SGOV", "TLT", "GLD"]);

const NARRATIVE_OF = new Map<string, string[]>();
for (const n of NARRATIVES) {
  for (const s of n.symbols) NARRATIVE_OF.set(s, [...(NARRATIVE_OF.get(s) ?? []), n.id]);
}

export interface Linkage {
  /** Underlying tickers of the xStocks the story resolves to, most confident first. */
  tickers: string[];
  narratives: string[];
  category: NewsCategory;
  /** True when the story is about the chain or the launchpad rather than one company. */
  venue: boolean;
}

/**
 * Resolves a story to assets. `hints` are symbols the source itself attached, which are
 * trusted directly — they are the publisher's own tagging, not our guess.
 */
export function linkStory(text: string, hints: string[] = []): Linkage {
  const found = new Map<string, number>(); // symbol -> confidence rank (lower is stronger)

  const add = (symbol: string, rank: number) => {
    if (!SYMBOLS.has(symbol)) return;
    const prev = found.get(symbol);
    if (prev === undefined || rank < prev) found.set(symbol, rank);
  };

  for (const h of hints) {
    // Stocktwits sends "TSLA" and "BTC.X"; only the equity half can be a pair asset.
    const symbol = h.replace(/^\$/, "").split(".")[0].toUpperCase();
    add(symbol, 0);
  }

  for (const m of text.matchAll(/\$([A-Za-z]{1,6})\b/g)) add(m[1].toUpperCase(), 1);

  for (const { symbol, pattern } of ALIAS_PATTERNS) if (pattern.test(text)) add(symbol, 2);

  for (const { symbol, pattern } of NAME_ENTRIES) if (pattern.test(text)) add(symbol, 3);

  for (const m of text.matchAll(/(?<![\w$])([A-Z]{3,5})(?![\w])/g)) {
    const symbol = m[1];
    if (!BARE_STOPLIST.has(symbol)) add(symbol, 4);
  }

  const tickers = [...found.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const narratives = [...new Set(tickers.flatMap((t) => NARRATIVE_OF.get(t) ?? []))];

  const venueChain = VENUE.chain.test(text);
  const venueProtocol = VENUE.protocol.test(text);
  const venueCompany = VENUE.company.test(text);

  const companyTickers = tickers.filter((t) => !INDEX_PROXIES.has(t));

  const category: NewsCategory = venueCompany
    ? "company"
    : venueProtocol
      ? "protocol"
      : venueChain
        ? "chain"
        : companyTickers.length === 0
          ? "markets"
          : CRYPTO.test(text)
            ? "crypto"
            : "stocks";

  return { tickers, narratives, category, venue: venueChain || venueProtocol || venueCompany };
}

export const isTokenisedStock = (symbol: string) => SYMBOLS.has(symbol.toUpperCase());
