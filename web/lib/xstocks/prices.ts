import { prices as jupiterPrices } from "../jupiter/client";
import { WSOL_MINT } from "../solana/program";

/**
 * USD prices for xStocks (and SOL) from Jupiter's price API, cached briefly. Pricing is decorative on the vault
 * and claims pages: a failure returns an empty map rather than an error.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; price: number }>();

export async function getPricesFor(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = Date.now();
  const missing: string[] = [];
  for (const m of new Set(mints)) {
    const hit = cache.get(m);
    if (hit && now - hit.at < TTL_MS) out.set(m, hit.price);
    else missing.push(m);
  }
  if (missing.length) {
    try {
      const fresh = await jupiterPrices(missing);
      for (const [m, p] of fresh) {
        cache.set(m, { at: now, price: p });
        out.set(m, p);
      }
    } catch {
      // stale-or-nothing: the UI shows "–" for unpriced legs
    }
  }
  return out;
}

export async function solUsd(): Promise<number | null> {
  const p = await getPricesFor([WSOL_MINT.toBase58()]);
  return p.get(WSOL_MINT.toBase58()) ?? null;
}
