/**
 * Narrative baskets.
 *
 * A StonkFun coin pays its creator in SOL. That forces anyone with a thesis wider
 * than a single ticker — "AI infrastructure", "nuclear restart", "quantum" — to bet the
 * whole coin on one name and hope it is the right one. These baskets are the shape of
 * the idea instead: every symbol below is an xStock that exists on Solana today
 * (see stock-tokens.generated.ts), so a basket can actually be paid out.
 *
 * Membership is editorial; the prices, weights and spreads shown against a basket are
 * always read live and never stored here.
 */
import { MAINNET_STOCK_TOKENS } from "./stock-tokens.generated";

export interface Narrative {
  id: string;
  name: string;
  /** The idea the basket expresses, in the words a creator would use. */
  thesis: string;
  /** Why picking one name inside it is a coin flip. */
  dispersion: string;
  symbols: string[];
  accent: string;
}

export const NARRATIVES: Narrative[] = [
  {
    id: "ai-infra",
    name: "AI Infrastructure",
    thesis: "The compute build-out gets paid for whoever wins the model race.",
    dispersion: "Racks, optics, power and silicon all bill the same capex — but not in the same quarter.",
    symbols: ["NVDA", "AVGO", "MRVL", "ANET", "VRT", "SMCI", "CRWV", "NBIS", "ALAB", "CRDO"],
    accent: "#ff6b3d",
  },
  {
    id: "fabs",
    name: "Silicon & Fabs",
    thesis: "Someone has to actually print the wafers.",
    dispersion: "Tool makers, foundries and memory run on different cycles inside one supply chain.",
    symbols: ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "MU", "INTC", "ONTO", "TER", "AEHR"],
    accent: "#7b93ff",
  },
  {
    id: "nuclear",
    name: "Nuclear & The Grid",
    thesis: "Datacentres need power faster than the grid can build it.",
    dispersion: "SMR developers are pre-revenue; the utilities selling them interconnects are not.",
    symbols: ["OKLO", "SMR", "NNE", "CEG", "VST", "GEV", "PWR", "POWL"],
    accent: "#3dd68c",
  },
  {
    id: "quantum",
    name: "Quantum",
    thesis: "One of these gets to error correction first.",
    dispersion: "Four companies, four architectures, and no consensus on which physics wins.",
    symbols: ["IONQ", "RGTI", "QBTS", "QUBT"],
    accent: "#4dd8e8",
  },
  {
    id: "space",
    name: "Space & Defense",
    thesis: "Launch cadence and autonomous defense are the same budget line now.",
    dispersion: "Primes compound slowly; the small-launch names move on single contracts.",
    symbols: ["RKLB", "ASTS", "LUNR", "RDW", "SPCX", "AVAV", "KTOS", "LMT", "LHX", "HII"],
    accent: "#e8b54d",
  },
  {
    id: "crypto",
    name: "Crypto Balance Sheets",
    thesis: "Public equities used as a levered wrapper on the asset itself.",
    dispersion: "Exchanges, treasuries and miners share a beta and nothing else.",
    symbols: ["COIN", "MSTR", "CRCL", "GLXY", "BULL", "WULF", "IREN", "CLSK"],
    accent: "#ffa940",
  },
  {
    id: "robotics",
    name: "Robotics & Autonomy",
    thesis: "Software that moves things without a person in the loop.",
    dispersion: "One of these ships at scale; the rest are pilots with a good deck.",
    symbols: ["TSLA", "PATH", "AUR", "OUST", "RCAT", "JOBY", "AXON", "SOUN"],
    accent: "#4d8dff",
  },
  {
    id: "retail",
    name: "Retail Rebellion",
    thesis: "The tickers that trade on conviction instead of guidance.",
    dispersion: "Correlated on the way up and completely uncorrelated on the way down.",
    symbols: ["GME", "AMC", "DJT", "RDDT", "HIMS", "CVNA", "SNAP", "KSS", "CLOV"],
    accent: "#ff5c5c",
  },
  {
    id: "mag7",
    name: "The Majors",
    thesis: "The index, minus the index fund.",
    dispersion: "Seven names that carry the market and rarely lead it at the same time.",
    symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
    accent: "#b8c0cc",
  },
];

const BY_SYMBOL = new Map(MAINNET_STOCK_TOKENS.map((t) => [t.symbol, t]));

/** Drops any symbol that is not a deployed token, so a basket never promises an asset
 *  that cannot be paired. */
export function narrativeTokens(n: Narrative) {
  return n.symbols.map((s) => BY_SYMBOL.get(s)).filter((t): t is NonNullable<typeof t> => Boolean(t));
}

export const narrativeById = (id: string) => NARRATIVES.find((n) => n.id === id);

/** Every symbol used by any basket — the set the terminal needs live prices for. */
export const NARRATIVE_SYMBOLS = [...new Set(NARRATIVES.flatMap((n) => n.symbols))];
