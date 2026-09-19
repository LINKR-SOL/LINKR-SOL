import { PublicKey } from "@solana/web3.js";
import { envValue } from "../solana/cluster";
import { keeperKeypair } from "../solana/keeper";
import { MAINNET_STOCK_TOKENS } from "../stock-tokens.generated";

/**
 * Custodial mode has no on-chain Config account; the same knobs come from the environment. Names mirror the
 * program's fields so the admin page and the APIs read the same shape in both modes.
 */
export interface CustodialConfig {
  operator: string;
  protocolShareBps: number;
  protocolRecipient: string;
  /** seconds between a payout being published and becoming claimable */
  disputeWindow: number;
  /** seconds a published payout stays claimable before it expires back into the pot */
  claimWindow: number;
  minEpochLength: number;
  paused: boolean;
  /** basket mints creators may pick, base58 */
  allowlist: string[];
}

const num = (name: string, fallback: number) => {
  const v = Number(envValue(name));
  return Number.isFinite(v) && envValue(name) !== undefined ? v : fallback;
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** BASKET_ALLOWLIST accepts underlying tickers (NVDA), xStocks symbols (NVDAx) or raw mints, comma separated. */
export function resolveAllowlist(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const item of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (BASE58.test(item)) {
      out.push(item);
      continue;
    }
    const up = item.toUpperCase();
    const stock = MAINNET_STOCK_TOKENS.find((t) => t.symbol.toUpperCase() === up || t.xSymbol.toUpperCase() === up);
    if (stock) out.push(stock.mint);
  }
  return [...new Set(out)];
}

export function custodialConfig(): CustodialConfig {
  const keeper = keeperKeypair();
  const operator = keeper?.publicKey.toBase58() ?? PublicKey.default.toBase58();
  return {
    operator,
    protocolShareBps: Math.min(Math.max(num("PROTOCOL_SHARE_BPS", 500), 0), 2_000),
    protocolRecipient: envValue("PROTOCOL_RECIPIENT") ?? operator,
    disputeWindow: num("DISPUTE_WINDOW_S", 600),
    claimWindow: num("CLAIM_WINDOW_S", 180 * 86_400),
    minEpochLength: num("MIN_EPOCH_LENGTH_S", 3_600),
    paused: (envValue("VAULT_PAUSED") ?? "0") === "1",
    allowlist: resolveAllowlist(envValue("BASKET_ALLOWLIST")),
  };
}
