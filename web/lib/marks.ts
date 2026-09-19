/** Brand marks used by the pair chips, activity tape and orbit visuals. */
export interface AssetMark {
  symbol: string;
  name: string;
  logo: string;
  color: string;
  kind: "stock" | "crypto" | "index";
}

export const ASSET_MARKS: AssetMark[] = [
  { symbol: "NVDA", name: "Nvidia", logo: "/nvidia.svg", color: "#76b900", kind: "stock" },
  { symbol: "AMD", name: "Advanced Micro Devices", logo: "/amd.svg", color: "#ff5c5c", kind: "stock" },
  { symbol: "AAPL", name: "Apple", logo: "/apple.svg", color: "#111111", kind: "stock" },
  { symbol: "TSLA", name: "Tesla", logo: "/tesla.svg", color: "#e82127", kind: "stock" },
  { symbol: "META", name: "Meta", logo: "/meta.svg", color: "#4d8dff", kind: "stock" },
  { symbol: "SOL", name: "Solana", logo: "/solana.svg", color: "#9945ff", kind: "crypto" },
  { symbol: "SPY", name: "S&P 500", logo: "/spy.svg", color: "#ef3e42", kind: "index" },
];

const BY_SYMBOL = new Map(ASSET_MARKS.map((a) => [a.symbol.toUpperCase(), a]));

export function assetMark(symbol: string | null | undefined): AssetMark | undefined {
  return symbol ? BY_SYMBOL.get(symbol.toUpperCase()) : undefined;
}

/** Deterministic fallback tint for tokens with no brand mark. */
export function markColor(symbol: string): string {
  const known = assetMark(symbol);
  if (known) return known.color;
  const palette = ["#b8391a", "#0f6b78", "#15703f", "#26409e", "#7d5c0e", "#9c1f1f"];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/**
 * Logo for a tokenised stock: the local brand mark when we ship one, else the issuer's artwork
 * (Backed publishes a per-ticker logo for every xStock), else a coloured letter tile.
 */
export function stockLogo(symbol: string, issuerLogo?: string | null): string | null {
  return assetMark(symbol)?.logo ?? issuerLogo ?? null;
}
