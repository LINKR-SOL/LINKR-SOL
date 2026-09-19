import { cx } from "./ui/primitives";
import { assetMark } from "@/lib/marks";
import { STOCK_LOGOS, STOCK_LOGOS_LIGHT } from "@/lib/stock-logos.generated";

/**
 * Best artwork we have for a ticker, in order:
 *   1. our own brand SVG (SOL, SPY … — crisp at any size)
 *   2. the downloaded stock logo in /public/stocks
 *   3. whatever the indexer recorded
 * The brokerage CDN is last on purpose: it answers with the same generic house logo for every
 * token it has no artwork for, which makes a whole basket look identical.
 */
export function logoNeedsDarkGround(symbol: string): boolean {
  return !assetMark(symbol) && STOCK_LOGOS_LIGHT.has(symbol.toUpperCase());
}

export function resolveLogo(symbol: string, logoUrl?: string | null): string | null {
  const brand = assetMark(symbol)?.logo;
  if (brand) return brand;
  const ticker = symbol.toUpperCase();
  if (STOCK_LOGOS.has(ticker)) return `/stocks/${ticker}.png`;
  return logoUrl ?? null;
}

const palette = ["#b8391a", "#0f6b78", "#15703f", "#26409e", "#7d5c0e", "#9c1f1f", "#1a4f96", "#10656f"];

export function TokenIcon({ symbol, address, logoUrl, size = 24, className }: { symbol: string; address?: string; logoUrl?: string | null; size?: number; className?: string }) {
  const seed = (address ?? symbol).toLowerCase();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const color = palette[h % palette.length];
  const src = resolveLogo(symbol, logoUrl);
  if (src) {
    // Logos come in every shape: square app icons, wide wordmarks, tall glyphs. Setting both
    // width and height on the <img> stretched them, so the circle is its own element and the
    // artwork is contained inside it with a little breathing room.
    return (
      <span
        className={cx(
          "inline-grid place-items-center rounded-full shrink-0 overflow-hidden ring-1",
          // A quarter of the stock logos are white artwork drawn for dark backgrounds; on a white
          // disc they vanish, so those get an inverted ground.
          logoNeedsDarkGround(symbol) ? "bg-[#1a1a18] ring-white/10" : "bg-white ring-black/5",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={symbol} loading="lazy" className="object-contain" style={{ width: "76%", height: "76%" }} />
      </span>
    );
  }
  return (
    <span
      className={cx("inline-flex items-center justify-center rounded-full shrink-0 font-semibold text-white", className)}
      style={{ width: size, height: size, background: color, fontSize: Math.max(9, size * 0.38) }}
      aria-hidden
    >
      {symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()}
    </span>
  );
}

export function TokenStack({ tokens, size = 22 }: { tokens: { symbol: string; address: string; logoUrl?: string | null }[]; size?: number }) {
  return (
    <span className="inline-flex items-center">
      {tokens.map((t, i) => (
        <TokenIcon key={t.address} symbol={t.symbol} address={t.address} logoUrl={t.logoUrl} size={size} className={cx("ring-2 ring-surface", i > 0 && "-ml-2")} />
      ))}
    </span>
  );
}
