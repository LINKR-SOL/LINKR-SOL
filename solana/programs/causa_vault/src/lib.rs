//! CAUSA dividend vaults on Solana.
//!
//! A vault is the pump.fun `creator` of one coin. Creator fees pump credits to the vault PDA are wrapped,
//! split by a fixed basket of tokenised stocks (xStocks), swapped by the keeper (Jupiter) under on-chain
//! delta measurement, and paid out to the coin's holders in Merkle-root epochs computed off-chain from
//! time-weighted balances. Accounting is measured from balances, never trusted from return values.
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod merkle;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("99n7VGd6132b4UUwhSezLm9xXssdnJFiSPrEKkCuMHPF");

#[program]
pub mod causa_vault {
    use super::*;

    // --- admin ---
    pub fn init_config(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
        admin::handle_init_config(ctx, params)
    }

    pub fn update_config(ctx: Context<AdminOnly>, params: UpdateConfigParams) -> Result<()> {
        admin::handle_update_config(ctx, params)
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        admin::handle_transfer_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        admin::handle_accept_admin(ctx)
    }

    pub fn allow_basket_mint(ctx: Context<AllowBasketMint>) -> Result<()> {
        admin::handle_allow_basket_mint(ctx)
    }

    pub fn revoke_basket_mint(ctx: Context<RevokeBasketMint>) -> Result<()> {
        admin::handle_revoke_basket_mint(ctx)
    }

    // --- vault lifecycle ---
    pub fn create_vault<'info>(
        ctx: Context<'info,CreateVault<'info>>,
        params: CreateVaultParams,
    ) -> Result<()> {
        create_vault::handle_create_vault(ctx, params)
    }

    pub fn bind_launch(ctx: Context<BindLaunch>) -> Result<()> {
        create_vault::handle_bind_launch(ctx)
    }

    pub fn set_auto_claim(ctx: Context<SetAutoClaim>, enabled: bool) -> Result<()> {
        create_vault::handle_set_auto_claim(ctx, enabled)
    }

    // --- harvest ---
    pub fn wrap_fees(ctx: Context<WrapFees>) -> Result<u64> {
        harvest::handle_wrap_fees(ctx)
    }

    pub fn harvest_intake<'info>(
        ctx: Context<'info,HarvestIntake<'info>>,
        max_input: u64,
    ) -> Result<()> {
        harvest::handle_harvest_intake(ctx, max_input)
    }

    pub fn swap_begin(ctx: Context<SwapBegin>, leg: u8) -> Result<()> {
        harvest::handle_swap_begin(ctx, leg)
    }

    pub fn swap_settle(ctx: Context<SwapSettle>, leg: u8, min_out: u64) -> Result<()> {
        harvest::handle_swap_settle(ctx, leg, min_out)
    }

    // --- epochs ---
    pub fn publish_epoch(ctx: Context<PublishEpoch>, params: PublishEpochParams) -> Result<()> {
        epochs::handle_publish_epoch(ctx, params)
    }

    pub fn cancel_epoch(ctx: Context<CancelEpoch>) -> Result<()> {
        epochs::handle_cancel_epoch(ctx)
    }

    pub fn expire_epoch(ctx: Context<ExpireEpoch>) -> Result<()> {
        epochs::handle_expire_epoch(ctx)
    }

    // --- claims ---
    pub fn claim<'info>(ctx: Context<'info,Claim<'info>>, params: ClaimParams) -> Result<()> {
        claims::handle_claim(ctx, params)
    }

    pub fn rescue(ctx: Context<Rescue>) -> Result<()> {
        claims::handle_rescue(ctx)
    }
}
