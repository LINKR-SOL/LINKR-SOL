use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::{constants::*, error::VaultError, events::*, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitConfigParams {
    pub operator: Pubkey,
    pub protocol_share_bps: u16,
    pub protocol_recipient: Pubkey,
    pub dispute_window: u32,
    pub claim_window: u32,
    pub min_epoch_length: u32,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(ctx: Context<InitConfig>, p: InitConfigParams) -> Result<()> {
    require!(p.protocol_share_bps <= MAX_PROTOCOL_SHARE_BPS, VaultError::ProtocolShareTooHigh);
    require!(p.dispute_window < p.min_epoch_length, VaultError::DisputeWindowTooLong);
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.pending_admin = Pubkey::default();
    c.operator = p.operator;
    c.protocol_share_bps = p.protocol_share_bps;
    c.protocol_recipient = p.protocol_recipient;
    c.dispute_window = p.dispute_window;
    c.claim_window = p.claim_window;
    c.min_epoch_length = p.min_epoch_length;
    c.paused = false;
    c.vault_count = 0;
    c.bump = ctx.bumps.config;
    let ev = config_event(c);
    emit_cpi!(ev);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigParams {
    pub operator: Option<Pubkey>,
    pub protocol_share_bps: Option<u16>,
    pub protocol_recipient: Option<Pubkey>,
    pub dispute_window: Option<u32>,
    pub claim_window: Option<u32>,
    pub min_epoch_length: Option<u32>,
    pub paused: Option<bool>,
}

pub fn handle_update_config(ctx: Context<AdminOnly>, p: UpdateConfigParams) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if let Some(v) = p.operator {
        c.operator = v;
    }
    if let Some(v) = p.protocol_share_bps {
        require!(v <= MAX_PROTOCOL_SHARE_BPS, VaultError::ProtocolShareTooHigh);
        c.protocol_share_bps = v;
    }
    if let Some(v) = p.protocol_recipient {
        c.protocol_recipient = v;
    }
    if let Some(v) = p.dispute_window {
        c.dispute_window = v;
    }
    if let Some(v) = p.claim_window {
        c.claim_window = v;
    }
    if let Some(v) = p.min_epoch_length {
        c.min_epoch_length = v;
    }
    if let Some(v) = p.paused {
        c.paused = v;
    }
    require!(c.dispute_window < c.min_epoch_length, VaultError::DisputeWindowTooLong);
    let ev = config_event(c);
    emit_cpi!(ev);
    Ok(())
}

pub fn handle_transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = pending_admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.pending_admin.key();
    c.pending_admin = Pubkey::default();
    let ev = config_event(c);
    emit_cpi!(ev);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AllowBasketMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(
        init,
        payer = admin,
        space = 8 + AllowedBasketMint::INIT_SPACE,
        seeds = [BASKET_SEED, mint.key().as_ref()],
        bump
    )]
    pub basket: Account<'info, AllowedBasketMint>,
    pub system_program: Program<'info, System>,
}

pub fn handle_allow_basket_mint(ctx: Context<AllowBasketMint>) -> Result<()> {
    let b = &mut ctx.accounts.basket;
    b.mint = ctx.accounts.mint.key();
    b.token_program = ctx.accounts.token_program.key();
    b.decimals = ctx.accounts.mint.decimals;
    b.bump = ctx.bumps.basket;
    emit_cpi!(BasketMintUpdated { mint: b.mint, allowed: true });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct RevokeBasketMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, close = admin, seeds = [BASKET_SEED, basket.mint.as_ref()], bump = basket.bump)]
    pub basket: Account<'info, AllowedBasketMint>,
}

pub fn handle_revoke_basket_mint(ctx: Context<RevokeBasketMint>) -> Result<()> {
    emit_cpi!(BasketMintUpdated { mint: ctx.accounts.basket.mint, allowed: false });
    Ok(())
}

fn config_event(c: &Config) -> ConfigUpdated {
    ConfigUpdated {
        admin: c.admin,
        operator: c.operator,
        protocol_share_bps: c.protocol_share_bps,
        protocol_recipient: c.protocol_recipient,
        dispute_window: c.dispute_window,
        claim_window: c.claim_window,
        min_epoch_length: c.min_epoch_length,
        paused: c.paused,
    }
}
