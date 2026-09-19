use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::VaultError;

/// Protocol-wide configuration (the old DividendVaultFactory storage). One per program.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Two-step admin transfer; `Pubkey::default()` when none is pending.
    pub pending_admin: Pubkey,
    /// The keeper. Harvests, settles swaps, publishes roots, delivers claims.
    pub operator: Pubkey,
    pub protocol_share_bps: u16,
    pub protocol_recipient: Pubkey,
    /// Seconds after `publish_epoch` during which the creator or admin may cancel it.
    pub dispute_window: u32,
    /// Seconds after `claimable_at` before anyone may expire the epoch.
    pub claim_window: u32,
    pub min_epoch_length: u32,
    pub paused: bool,
    pub vault_count: u64,
    pub bump: u8,
}

/// Marker: this mint may be a basket leg. PDA ["basket", mint].
#[account]
#[derive(InitSpace)]
pub struct AllowedBasketMint {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub bump: u8,
}

/// One basket leg with its accounting. Invariant per leg (raw units, checked in tests):
/// `vault_ata(mint).amount >= unallocated + allocated` (+ every leg's `pending_swap` for the quote mint).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Eq)]
pub struct Leg {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub weight_bps: u16,
    /// Harvested, not yet assigned to an epoch.
    pub unallocated: u64,
    /// Assigned to open epochs, not yet claimed.
    pub allocated: u64,
    /// Quote reserved for this leg by `harvest_intake`, consumed by `swap_begin`/`swap_settle`.
    pub pending_swap: u64,
    pub harvested_total: u64,
}

impl Leg {
    pub fn accounted(&self) -> Result<u64> {
        self.unallocated.checked_add(self.allocated).ok_or_else(|| VaultError::Overflow.into())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub creator: Pubkey,
    pub salt: u64,
    pub bump: u8,
    /// The mint the creator committed to at `create_vault`; `bind_launch` only accepts this one.
    pub expected_mint: Pubkey,
    /// `Pubkey::default()` until bound.
    pub launch_mint: Pubkey,
    /// Creator fees arrive in this mint (wrapped SOL for SOL-quoted coins).
    pub quote_mint: Pubkey,
    pub quote_token_program: Pubkey,
    pub epoch_length: u32,
    pub bound_at: i64,
    pub last_period_end: i64,
    pub epoch_count: u64,
    /// Creator opt-in for keeper-paid delivery.
    pub auto_claim: bool,
    #[max_len(10)]
    pub legs: Vec<Leg>,
    pub input_total: u64,
    pub protocol_cut_total: u64,
    pub harvest_count: u64,
    /// Transient swap session; only ever set inside one transaction (see swap_begin/swap_settle).
    pub swap_in_flight: bool,
    pub swap_leg: u8,
    pub swap_pre_balance: u64,
}

impl Vault {
    pub fn is_bound(&self) -> bool {
        self.launch_mint != Pubkey::default()
    }

    pub fn leg_index(&self, mint: &Pubkey) -> Option<usize> {
        self.legs.iter().position(|l| &l.mint == mint)
    }

    /// Quote units already spoken for: legs paying out in the quote mint plus swaps not yet started.
    pub fn quote_accounted(&self) -> Result<u64> {
        let mut total: u64 = 0;
        for l in &self.legs {
            if l.mint == self.quote_mint {
                total = total.checked_add(l.accounted()?).ok_or(VaultError::Overflow)?;
            }
            total = total.checked_add(l.pending_swap).ok_or(VaultError::Overflow)?;
        }
        Ok(total)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum EpochStatus {
    Open,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct EpochLeg {
    pub mint: Pubkey,
    pub amount: u64,
    pub claimed_total: u64,
}

/// One payout epoch. PDA ["epoch", vault, id].
#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub vault: Pubkey,
    pub id: u64,
    pub root: [u8; 32],
    pub period_start: i64,
    pub period_end: i64,
    pub claimable_at: i64,
    pub holder_count: u32,
    pub status: EpochStatus,
    #[max_len(10)]
    pub legs: Vec<EpochLeg>,
    pub bump: u8,
}

/// Existence = claimed. PDA ["claim", epoch, account].
#[account]
#[derive(InitSpace)]
pub struct ClaimStatus {
    pub epoch: Pubkey,
    pub account: Pubkey,
    pub bump: u8,
}

/// Reads `creator` out of a raw pump.fun `BondingCurve` account without depending on the pump crate.
pub fn pump_bonding_curve_creator(curve: &AccountInfo) -> Result<Pubkey> {
    require_keys_eq!(*curve.owner, PUMP_PROGRAM_ID, VaultError::NotPumpAccount);
    let data = curve.try_borrow_data()?;
    require!(data.len() >= PUMP_BONDING_CURVE_CREATOR_OFFSET + 32, VaultError::NotPumpAccount);
    require!(data[..8] == PUMP_BONDING_CURVE_DISCRIMINATOR, VaultError::NotPumpAccount);
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[PUMP_BONDING_CURVE_CREATOR_OFFSET..PUMP_BONDING_CURVE_CREATOR_OFFSET + 32]);
    Ok(Pubkey::new_from_array(key))
}

/// The two bonding-curve PDAs pump derives for a mint (`create` and `create_v2`).
pub fn pump_bonding_curve_pdas(mint: &Pubkey) -> [Pubkey; 2] {
    let v1 = Pubkey::find_program_address(&[PUMP_BONDING_CURVE_SEED, mint.as_ref()], &PUMP_PROGRAM_ID).0;
    let v2 = Pubkey::find_program_address(&[PUMP_BONDING_CURVE_V2_SEED, mint.as_ref()], &PUMP_PROGRAM_ID).0;
    [v1, v2]
}
