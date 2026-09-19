import { quote as jupiterQuote, type JupiterQuote } from "../jupiter/client";
import { envValue } from "../solana/cluster";

/**
 * Server-side quoting of a vault harvest: the net input is split by basket weight exactly as
 * `harvest_intake` does on chain, and every leg that is not the quote mint is priced on Jupiter.
 * `minOut` per leg is the quoted output minus the slippage allowance; `swap_settle` enforces it on chain.
 * Used by the keeper and by /api/vaults/[address]/harvest-quote for the creator's manual harvest.
 */

export type SwapMode = "jupiter" | "mock" | "off";

/** `mock` mints the quoted amount straight into the vault (devnet, where xStocks do not exist); `off` skips swaps. */
export function swapMode(): SwapMode {
  const v = (envValue("DIVIDEND_SWAP") ?? "jupiter").toLowerCase();
  return v === "mock" || v === "off" ? v : "jupiter";
}

/** Mock price in output raw units per lamport, e.g. "0.0001" (1 SOL of fees -> 100_000 raw units). */
export function mockPrice(): number {
  return Number(envValue("DIVIDEND_MOCK_PRICE") ?? "0.0001");
}

export interface HarvestLeg {
  mint: string;
  amountIn: bigint;
  quote: bigint; // expected output (equals amountIn for the leg that needs no swap)
  minOut: bigint;
  swap: boolean;
  jupiter: JupiterQuote | null;
}

export interface HarvestQuote {
  quoteMint: string;
  gross: bigint;
  protocolCut: bigint;
  net: bigint;
  legs: HarvestLeg[];
  minOuts: bigint[];
  slippageBps: number;
}

export interface HarvestQuoteInput {
  quoteMint: string;
  gross: bigint;
  basket: readonly { mint: string; weightBps: number }[];
  protocolShareBps: number;
  slippageBps: number;
}

/** Splits `net` by weight exactly like the program (integer remainder to the last leg). */
export function splitByWeight(net: bigint, weightsBps: readonly number[]): bigint[] {
  const n = weightsBps.length;
  const out: bigint[] = [];
  let spent = 0n;
  for (let i = 0; i < n; i++) {
    const legIn = i === n - 1 ? net - spent : (net * BigInt(weightsBps[i])) / 10_000n;
    spent += legIn;
    out.push(legIn);
  }
  return out;
}

export async function quoteHarvest(input: HarvestQuoteInput): Promise<HarvestQuote> {
  const { quoteMint, gross, basket, protocolShareBps, slippageBps } = input;
  const protocolCut = (gross * BigInt(protocolShareBps)) / 10_000n;
  const net = gross - protocolCut;
  const ins = splitByWeight(net, basket.map((b) => b.weightBps));
  const mode = swapMode();
  const legs: HarvestLeg[] = [];
  for (let i = 0; i < basket.length; i++) {
    const amountIn = ins[i];
    const swap = amountIn > 0n && basket[i].mint !== quoteMint;
    if (!swap) {
      legs.push({ mint: basket[i].mint, amountIn, quote: amountIn, minOut: 0n, swap: false, jupiter: null });
      continue;
    }
    if (mode === "mock") {
      const out = BigInt(Math.floor(Number(amountIn) * mockPrice()));
      legs.push({ mint: basket[i].mint, amountIn, quote: out, minOut: out, swap: true, jupiter: null });
      continue;
    }
    if (mode === "off") {
      legs.push({ mint: basket[i].mint, amountIn, quote: 0n, minOut: 0n, swap: true, jupiter: null });
      continue;
    }
    const q = await jupiterQuote({ inputMint: quoteMint, outputMint: basket[i].mint, amount: amountIn, slippageBps });
    const out = BigInt(q.outAmount);
    legs.push({ mint: basket[i].mint, amountIn, quote: out, minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n, swap: true, jupiter: q });
  }
  return { quoteMint, gross, protocolCut, net, legs, minOuts: legs.map((l) => l.minOut), slippageBps };
}

/**
 * Finds the largest harvest (starting from `gross`, halving down to `floor`) the venue can absorb: a thin
 * xStock pool may refuse a large order, so fees are converted in slices and the rest stays idle in the vault.
 */
export async function quoteSizedHarvest(input: HarvestQuoteInput & { floor: bigint }): Promise<{ quote: HarvestQuote; attempts: number }> {
  let g = input.gross;
  let attempts = 0;
  let lastError: unknown = null;
  while (g >= input.floor && g > 0n && attempts < 12) {
    attempts++;
    try {
      return { quote: await quoteHarvest({ ...input, gross: g }), attempts };
    } catch (e) {
      lastError = e;
      g /= 2n;
    }
  }
  throw new Error(`no harvest size works: ${String((lastError as Error)?.message ?? lastError).slice(0, 160)}`);
}
