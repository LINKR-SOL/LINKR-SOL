use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const BASKET_SEED: &[u8] = b"basket";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const EPOCH_SEED: &[u8] = b"epoch";
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";
#[constant]
pub const MAX_BASKET: u8 = 10;
#[constant]
pub const BPS: u16 = 10_000;
#[constant]
pub const MAX_PROTOCOL_SHARE_BPS: u16 = 2_000;

/// Wrapped SOL. The only quote mint v1 accepts.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// pump.fun bonding-curve program (same id on mainnet and devnet).
pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const PUMP_BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const PUMP_BONDING_CURVE_V2_SEED: &[u8] = b"bonding-curve-v2";
/// sha256("account:BondingCurve")[..8]
pub const PUMP_BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60];
/// Byte offset of `creator: Pubkey` inside a pump `BondingCurve` account
/// (8 discriminator + 5 × u64 reserves/supply + 1 `complete` flag).
pub const PUMP_BONDING_CURVE_CREATOR_OFFSET: usize = 8 + 5 * 8 + 1;
