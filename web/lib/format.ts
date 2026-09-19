export const ONE = 10n ** 18n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Raw units -> decimal string, trailing zeros trimmed (no float in between). */
export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Decimal string -> raw units. Throws on more fractional digits than the token has. */
export function parseUnits(value: string, decimals: number): bigint {
  const s = value.trim();
  if (!/^-?\d*\.?\d*$/.test(s) || s === "" || s === "." || s === "-") throw new Error(`invalid amount: ${value}`);
  const neg = s.startsWith("-");
  const [int = "0", frac = ""] = (neg ? s.slice(1) : s).split(".");
  if (frac.length > decimals) throw new Error(`too many decimals: ${value}`);
  const raw = BigInt(int || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return neg ? -raw : raw;
}

/** Raw -> human number (double). Fine for display; never for math. */
export function toNumber(raw: bigint | string, decimals: number): number {
  return Number(formatUnits(BigInt(raw), decimals));
}

export const formatSol = (lamports: bigint | number | string, maxFrac = 4) =>
  `${formatNumber(toNumber(BigInt(lamports), 9), { maxFrac })} SOL`;

/** Compact, sensible token amount formatting. */
export function formatAmount(raw: bigint | string | undefined | null, decimals: number, opts: { maxFrac?: number; compact?: boolean } = {}): string {
  if (raw === undefined || raw === null) return "–";
  const n = toNumber(raw, decimals);
  return formatNumber(n, opts);
}

export function formatNumber(n: number, opts: { maxFrac?: number; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1_000_000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  const maxFrac = opts.maxFrac ?? (abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8);
  if (abs < 1e-8) return "<0.00000001";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFrac }).format(n);
}

export function formatUsd(v: number | string | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined) return "–";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "–";
  if (opts.compact && Math.abs(n) >= 100_000) {
    return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);
}

/** 1e18-scaled fraction -> percent string. */
export function formatPct18(x: bigint | string, maxFrac = 2): string {
  const n = Number(formatUnits(BigInt(x), 16));
  return `${formatNumber(n, { maxFrac })}%`;
}

export function formatPct(n: number, maxFrac = 2): string {
  return `${formatNumber(n * 100, { maxFrac })}%`;
}

export function shortAddress(a: string, chars = 4): string {
  return `${a.slice(0, chars)}…${a.slice(-chars)}`;
}

/** Parses user input into raw units; returns null for empty/invalid. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return null;
  try {
    return parseUnits(s, decimals);
  } catch {
    return null;
  }
}

const SCALE = 1_000_000_000n;

/** Token-2022 Scaled UI Amount: raw units -> displayed shares (multiplier is the issuer's f64, e.g. 4 after a 4:1 split). */
export function toShares(raw: bigint, multiplier: number | string | null | undefined): bigint {
  const m = Number(multiplier ?? 1);
  if (!Number.isFinite(m) || m === 1) return raw;
  return (raw * BigInt(Math.round(m * 1e9))) / SCALE;
}

/** Token-2022 Scaled UI Amount: displayed shares -> raw units, rounding down. */
export function fromShares(shares: bigint, multiplier: number | string | null | undefined): bigint {
  const m = Number(multiplier ?? 1);
  if (!Number.isFinite(m) || m === 1) return shares;
  return (shares * SCALE) / BigInt(Math.round(m * 1e9));
}

/** Wall-clock time of a unix timestamp in the viewer's locale, "14:05:50" — seconds included by default. */
export function formatClock(unix: number, opts: { seconds?: boolean; date?: boolean } = {}): string {
  const d = new Date(unix * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: opts.seconds === false ? undefined : "2-digit" });
  if (!opts.date) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

/** Relative wording for a countdown or elapsed time: "in 4 min 12 s", "in 2 h 5 min", "35 s ago". */
export function formatRelative(target: number, now: number): string {
  const d = target - now;
  const abs = Math.abs(d);
  let body: string;
  if (abs < 60) body = `${abs} s`;
  else if (abs < 3_600) body = `${Math.floor(abs / 60)} min ${abs % 60} s`;
  else if (abs < 86_400) body = `${Math.floor(abs / 3_600)} h ${Math.floor((abs % 3_600) / 60)} min`;
  else body = `${Math.floor(abs / 86_400)} d ${Math.floor((abs % 86_400) / 3_600)} h`;
  return d >= 0 ? `in ${body}` : `${body} ago`;
}

export function timeAgo(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Applies slippage (bps) to a minimum-out amount. */
export const withSlippageDown = (amount: bigint, bps: number) => (amount * BigInt(10_000 - bps)) / 10_000n;
export const withSlippageUp = (amount: bigint, bps: number) => (amount * BigInt(10_000 + bps)) / 10_000n;

/** formatUnits with a safe fallback for bad input. */
export function formatUnitsSafe(raw: string | bigint, decimals: number, maxFrac = 6): string {
  try {
    return formatNumber(Number(formatUnits(BigInt(raw), decimals)), { maxFrac });
  } catch {
    return "–";
  }
}

/** USD value of a raw token amount, or null when we have no price for it. */
export function usdOf(raw: string | bigint, decimals: number, priceUsd: string | null): number | null {
  if (!priceUsd) return null;
  const price = Number(priceUsd);
  if (!Number.isFinite(price)) return null;
  return toNumber(BigInt(raw), decimals) * price;
}
