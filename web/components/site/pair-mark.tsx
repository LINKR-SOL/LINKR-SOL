import { assetMark, markColor } from "@/lib/marks";
import { logoNeedsDarkGround, resolveLogo } from "@/components/token-icon";

/** Circular asset chip. Renders the brand mark when known, else a letter tile. */
export function PairMark({
  symbol,
  small = false,
  logoUrl,
}: {
  symbol: string;
  small?: boolean;
  logoUrl?: string | null;
}) {
  const known = assetMark(symbol);
  // Same precedence as TokenIcon: our brand SVGs, then the downloaded stock artwork, and only
  // then whatever the indexer recorded — the brokerage CDN answers with one generic house logo.
  const src = resolveLogo(symbol, logoUrl);
  const cls = `pair-mark${small ? " small" : ""}${src ? "" : " letter"}${
    src && logoNeedsDarkGround(symbol) ? " on-dark" : ""
  }`;
  return (
    <span className={cls} style={{ ["--pair-color" as string]: markColor(symbol) }}>
      {src ? <img alt={`${known?.name ?? symbol} logo`} src={src} /> : <b>{symbol.slice(0, 2).toUpperCase()}</b>}
    </span>
  );
}

/** Overlapping stack used in table rows. */
export function PairStack({ symbols, max = 4 }: { symbols: string[]; max?: number }) {
  const shown = symbols.slice(0, max);
  const rest = symbols.length - shown.length;
  return (
    <span className="pair-stack">
      {shown.map((s, i) => (
        <PairMark key={`${s}-${i}`} symbol={s} small />
      ))}
      {rest > 0 && <span className="more-pairs">+{rest}</span>}
    </span>
  );
}
