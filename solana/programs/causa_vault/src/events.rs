use anchor_lang::prelude::*;

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub protocol_share_bps: u16,
    pub protocol_recipient: Pubkey,
    pub dispute_window: u32,
    pub claim_window: u32,
    pub min_epoch_length: u32,
    pub paused: bool,
}

#[event]
pub struct BasketMintUpdated {
    pub mint: Pubkey,
    pub allowed: bool,
}

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub creator: Pubkey,
    pub salt: u64,
    pub expected_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub mints: Vec<Pubkey>,
    pub weights_bps: Vec<u16>,
    pub epoch_length: u32,
}

#[event]
pub struct LaunchBound {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub bound_at: i64,
}

#[event]
pub struct Harvested {
    pub vault: Pubkey,
    pub caller: Pubkey,
    pub input: u64,
    pub protocol_cut: u64,
    /// Per leg: quote reserved for swapping (or credited directly when the leg is the quote mint).
    pub leg_inputs: Vec<u64>,
}

#[event]
pub struct SwapSettled {
    pub vault: Pubkey,
    pub leg: u8,
    pub mint: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
}

#[event]
pub struct EpochPublished {
    pub vault: Pubkey,
    pub epoch: Pubkey,
    pub epoch_id: u64,
    pub root: [u8; 32],
    pub period_start: i64,
    pub period_end: i64,
    pub claimable_at: i64,
    pub mints: Vec<Pubkey>,
    pub amounts: Vec<u64>,
    pub holder_count: u32,
}

#[event]
pub struct EpochCancelled {
    pub vault: Pubkey,
    pub epoch_id: u64,
}

#[event]
pub struct EpochExpired {
    pub vault: Pubkey,
    pub epoch_id: u64,
    pub returned: Vec<u64>,
}

#[event]
pub struct Claimed {
    pub vault: Pubkey,
    pub epoch_id: u64,
    pub account: Pubkey,
    pub amounts: Vec<u64>,
}

#[event]
pub struct AutoClaimUpdated {
    pub vault: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct Rescued {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}
