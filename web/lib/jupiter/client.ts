import { AddressLookupTableAccount, PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import { envValue } from "../solana/cluster";

/**
 * Jupiter swap API. The free tier lives at lite-api.jup.ag; a key from portal.jup.ag unlocks api.jup.ag.
 * Endpoints and field names follow the Swap API v1 docs; JUPITER_API_BASE overrides the base if they move.
 */
const base = () => envValue("JUPITER_API_BASE") ?? (envValue("JUPITER_API_KEY") ? "https://api.jup.ag" : "https://lite-api.jup.ag");
const headers = () => {
  const h: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  const key = envValue("JUPITER_API_KEY");
  if (key) h["x-api-key"] = key;
  return h;
};

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
}

export async function quote(params: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number; onlyDirectRoutes?: boolean }): Promise<JupiterQuote> {
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: String(params.slippageBps),
    restrictIntermediateTokens: "true",
    ...(params.onlyDirectRoutes ? { onlyDirectRoutes: "true" } : {}),
  });
  const res = await fetch(`${base()}/swap/v1/quote?${q}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`jupiter quote ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as JupiterQuote;
}

interface RawInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

interface SwapInstructionsResponse {
  computeBudgetInstructions: RawInstruction[];
  setupInstructions: RawInstruction[];
  swapInstruction: RawInstruction;
  cleanupInstruction?: RawInstruction | null;
  addressLookupTableAddresses: string[];
}

const toIx = (r: RawInstruction) =>
  new TransactionInstruction({
    programId: new PublicKey(r.programId),
    keys: r.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(r.data, "base64"),
  });

export interface SwapInstructions {
  /** setup (ATA creation) + the swap itself; compute-budget ixs are dropped so the caller sets one budget for the whole tx */
  instructions: TransactionInstruction[];
  cleanup: TransactionInstruction | null;
  lookupTables: AddressLookupTableAccount[];
}

/**
 * Swap instructions for a keeper-signed swap whose output lands directly in `destinationTokenAccount`
 * (the vault's ATA). The keeper's WSOL is spent from its own ATA, so wrapping is off.
 */
export async function swapInstructions(
  connection: Connection,
  q: JupiterQuote,
  params: { userPublicKey: PublicKey; destinationTokenAccount: PublicKey; wrapAndUnwrapSol?: boolean },
): Promise<SwapInstructions> {
  const res = await fetch(`${base()}/swap/v1/swap-instructions`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      quoteResponse: q,
      userPublicKey: params.userPublicKey.toBase58(),
      destinationTokenAccount: params.destinationTokenAccount.toBase58(),
      // custodial vaults pay from native SOL, so Jupiter wraps for them; the program path spends WSOL it already holds
      wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? false,
      dynamicComputeUnitLimit: false,
      skipUserAccountsRpcCalls: false,
    }),
  });
  if (!res.ok) throw new Error(`jupiter swap-instructions ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as SwapInstructionsResponse;
  const lookupTables = await loadLookupTables(connection, body.addressLookupTableAddresses ?? []);
  return {
    instructions: [...(body.setupInstructions ?? []).map(toIx), toIx(body.swapInstruction)],
    cleanup: body.cleanupInstruction ? toIx(body.cleanupInstruction) : null,
    lookupTables,
  };
}

const altCache = new Map<string, AddressLookupTableAccount>();

export async function loadLookupTables(connection: Connection, addresses: string[]): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  const missing = addresses.filter((a) => !altCache.has(a));
  if (missing.length) {
    const infos = await connection.getMultipleAccountsInfo(missing.map((a) => new PublicKey(a)));
    infos.forEach((info, i) => {
      if (!info) return;
      altCache.set(missing[i], new AddressLookupTableAccount({ key: new PublicKey(missing[i]), state: AddressLookupTableAccount.deserialize(info.data) }));
    });
  }
  for (const a of addresses) {
    const t = altCache.get(a);
    if (t) out.push(t);
  }
  return out;
}

/** USD prices for a set of mints (Jupiter Price API v3). Missing mints are simply absent from the map. */
export async function prices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < mints.length; i += 50) {
    const ids = mints.slice(i, i + 50).join(",");
    const res = await fetch(`${base()}/price/v3?ids=${ids}`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) continue;
    const body = (await res.json()) as Record<string, { usdPrice?: number; price?: string | number }>;
    for (const [mint, v] of Object.entries(body)) {
      const p = Number(v?.usdPrice ?? v?.price);
      if (Number.isFinite(p) && p > 0) out.set(mint, p);
    }
  }
  return out;
}
