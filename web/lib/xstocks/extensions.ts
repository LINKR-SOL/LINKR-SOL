import { ExtensionType, getExtensionData, getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

/**
 * Token-2022 extension state that matters for dividends in xStocks:
 *  - Scaled UI Amount: the issuer's multiplier (splits, stock dividends). Raw amounts never change, so the vault
 *    accounts in raw units and only the display is scaled.
 *  - Pausable: while paused, every transfer fails, so claims must wait.
 */
export interface MintExtensions {
  tokenProgram: PublicKey;
  decimals: number;
  scaledUi: { multiplier: number; newMultiplier: number; effectiveAt: number } | null;
  paused: boolean;
}

// ScaledUiAmountConfig: authority (32) ‖ multiplier f64 LE ‖ new_multiplier_effective_timestamp i64 LE ‖ new_multiplier f64 LE
function decodeScaledUi(data: Buffer) {
  if (data.length < 56) return null;
  return {
    multiplier: data.readDoubleLE(32),
    effectiveAt: Number(data.readBigInt64LE(40)),
    newMultiplier: data.readDoubleLE(48),
  };
}

// PausableConfig: authority (32) ‖ paused u8
const decodePaused = (data: Buffer) => data.length >= 33 && data[32] === 1;

export function extensionsFromAccount(mint: PublicKey, info: AccountInfo<Buffer>): MintExtensions {
  const tokenProgram = info.owner;
  if (!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    const m = unpackMint(mint, info, TOKEN_PROGRAM_ID);
    return { tokenProgram, decimals: m.decimals, scaledUi: null, paused: false };
  }
  const m = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
  const scaled = getExtensionData(ExtensionType.ScaledUiAmountConfig, m.tlvData);
  const pausable = getExtensionData(ExtensionType.PausableConfig, m.tlvData);
  return {
    tokenProgram,
    decimals: m.decimals,
    scaledUi: scaled ? decodeScaledUi(scaled) : null,
    paused: pausable ? decodePaused(pausable) : false,
  };
}

export async function readMintExtensions(connection: Connection, mint: PublicKey): Promise<MintExtensions | null> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) return null;
  return extensionsFromAccount(mint, info);
}

export { getMint };
