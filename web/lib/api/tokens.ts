import type { Filter } from "mongodb";
import { PublicKey } from "@solana/web3.js";
import { activeCluster } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { TOKEN_PROGRAM_ID, WSOL_MINT } from "../solana/program";
import { collections } from "../db/collections";
import type { TokenDoc, TokenKind } from "../db/types";
import type { TokenJson } from "../api-types";
import { STOCK_BY_MINT } from "../stock-tokens.generated";
import { extensionsFromAccount } from "../xstocks/extensions";

const cluster = activeCluster;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function tokenToJson(t: TokenDoc): TokenJson {
  return {
    mint: t.mint,
    tokenProgram: t.tokenProgram,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    kind: t.kind,
    underlyingSymbol: t.underlyingSymbol,
    priceUsd: t.priceUsd ? t.priceUsd.toString() : null,
    priceSource: t.priceSource,
    scaledUi: t.scaledUi
      ? { multiplier: t.scaledUi.multiplier, newMultiplier: t.scaledUi.newMultiplier, effectiveAt: t.scaledUi.effectiveAt, paused: t.scaledUi.paused }
      : null,
    isVerified: t.isVerified,
    logoUrl: t.logoUrl,
  };
}

export function placeholderToken(mint: string): TokenJson {
  const reg = STOCK_BY_MINT.get(mint);
  if (reg) {
    return {
      mint, tokenProgram: "", symbol: reg.symbol, name: reg.name, decimals: 8, kind: "xstock", underlyingSymbol: reg.symbol,
      priceUsd: null, priceSource: "none", scaledUi: null, isVerified: true, logoUrl: reg.logoUrl,
    };
  }
  if (mint === WSOL_MINT.toBase58()) {
    return { mint, tokenProgram: TOKEN_PROGRAM_ID.toBase58(), symbol: "SOL", name: "Solana", decimals: 9, kind: "wsol", underlyingSymbol: null, priceUsd: null, priceSource: "none", scaledUi: null, isVerified: true, logoUrl: "/solana.svg" };
  }
  return {
    mint, tokenProgram: "", symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`, name: "Unknown token", decimals: 0, kind: "other", underlyingSymbol: null,
    priceUsd: null, priceSource: "none", scaledUi: null, isVerified: false, logoUrl: null,
  };
}

export function tokenJson(tokens: Map<string, TokenDoc>, mint: string): TokenJson {
  const t = tokens.get(mint);
  return t ? tokenToJson(t) : placeholderToken(mint);
}

/** Indexed token documents keyed by mint; all tokens for the cluster when no filter is given. */
export async function tokenMap(mints?: string[]): Promise<Map<string, TokenDoc>> {
  const c = await collections();
  const filter: Filter<TokenDoc> = { cluster };
  if (mints) filter._id = { $in: mints.map((m) => `${cluster}:${m}`) };
  const docs = await c.tokens.find(filter).toArray();
  return new Map(docs.map((t) => [t.mint, t]));
}

function kindOf(mint: string): TokenKind {
  if (mint === WSOL_MINT.toBase58()) return "wsol";
  if (mint === USDC_MINT) return "usdc";
  if (STOCK_BY_MINT.has(mint)) return "xstock";
  return "other";
}

/**
 * Makes sure every mint has a token document, reading decimals / token program / Token-2022 extension state
 * from chain for the ones we have not seen. Returns the map afterwards.
 */
export async function ensureTokens(mints: string[], opts: { kind?: TokenKind; refresh?: boolean } = {}): Promise<Map<string, TokenDoc>> {
  const c = await collections();
  const unique = [...new Set(mints)].filter((m) => {
    try {
      new PublicKey(m);
      return true;
    } catch {
      return false;
    }
  });
  const existing = await tokenMap(unique);
  const missing = opts.refresh ? unique : unique.filter((m) => !existing.has(m));
  if (missing.length) {
    const connection = serverConnection();
    const now = new Date();
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const infos = await connection.getMultipleAccountsInfo(chunk.map((m) => new PublicKey(m)), "confirmed");
      for (let k = 0; k < chunk.length; k++) {
        const info = infos[k];
        if (!info) continue;
        let ext;
        try {
          ext = extensionsFromAccount(new PublicKey(chunk[k]), info);
        } catch {
          continue; // not a mint
        }
        const reg = STOCK_BY_MINT.get(chunk[k]);
        const kind = opts.kind ?? kindOf(chunk[k]);
        const prev = existing.get(chunk[k]);
        const doc: TokenDoc = {
          _id: `${cluster}:${chunk[k]}`,
          cluster,
          mint: chunk[k],
          tokenProgram: ext.tokenProgram.toBase58(),
          symbol: prev?.symbol || reg?.symbol || (kind === "wsol" ? "SOL" : kind === "usdc" ? "USDC" : `${chunk[k].slice(0, 4)}…`),
          name: prev?.name || reg?.name || (kind === "wsol" ? "Solana" : kind === "usdc" ? "USD Coin" : "Unknown token"),
          decimals: ext.decimals,
          kind,
          underlyingSymbol: reg?.symbol ?? null,
          scaledUi: ext.scaledUi
            ? { multiplier: String(ext.scaledUi.multiplier), newMultiplier: String(ext.scaledUi.newMultiplier), effectiveAt: ext.scaledUi.effectiveAt, paused: ext.paused, syncedAt: now }
            : ext.paused
              ? { multiplier: "1", newMultiplier: "1", effectiveAt: 0, paused: true, syncedAt: now }
              : null,
          priceUsd: prev?.priceUsd ?? null,
          priceSource: prev?.priceSource ?? "none",
          priceUpdatedAt: prev?.priceUpdatedAt ?? null,
          logoUrl: prev?.logoUrl ?? reg?.logoUrl ?? (kind === "wsol" ? "/solana.svg" : null),
          isVerified: Boolean(reg) || kind === "wsol" || kind === "usdc",
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
        };
        await c.tokens.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
        existing.set(chunk[k], doc);
      }
    }
  }
  return existing;
}
