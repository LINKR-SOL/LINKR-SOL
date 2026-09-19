use anchor_lang::prelude::*;

use crate::{constants::*, error::VaultError, events::*, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishEpochParams {
    pub root: [u8; 32],
    /// Per basket leg, in basket order (zero for a leg that pays nothing this epoch).
    pub amounts: Vec<u64>,
    pub period_start: i64,
    pub period_end: i64,
    pub holder_count: u32,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishEpoch<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = operator,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, vault.key().as_ref(), &(vault.epoch_count + 1).to_le_bytes()],
        bump
    )]
    pub epoch: Account<'info, Epoch>,
    pub system_program: Program<'info, System>,
}

pub fn handle_publish_epoch(ctx: Context<PublishEpoch>, p: PublishEpochParams) -> Result<()> {
    let cfg = &ctx.accounts.config;
    require!(!cfg.paused, VaultError::Paused);
    let now = Clock::get()?.unix_timestamp;
    let vault_key = ctx.accounts.vault.key();
    let v = &mut ctx.accounts.vault;
    require!(v.is_bound(), VaultError::NotBound);
    require!(!v.swap_in_flight, VaultError::SwapInFlight);
    let n = v.legs.len();
    require!(p.amounts.len() == n, VaultError::LengthMismatch);
    require!(p.period_start == v.last_period_end, VaultError::PeriodMismatch);
    require!(
        p.period_end > p.period_start && p.period_end <= now && (p.period_end - p.period_start) >= v.epoch_length as i64,
        VaultError::InvalidPeriod
    );

    let mut legs = Vec::with_capacity(n);
    for i in 0..n {
        let a = p.amounts[i];
        let l = &mut v.legs[i];
        require!(a <= l.unallocated, VaultError::InsufficientUnallocated);
        l.unallocated -= a;
        l.allocated = l.allocated.checked_add(a).ok_or(VaultError::Overflow)?;
        legs.push(EpochLeg { mint: l.mint, amount: a, claimed_total: 0 });
    }
    v.epoch_count += 1;
    v.last_period_end = p.period_end;

    let e = &mut ctx.accounts.epoch;
    e.vault = vault_key;
    e.id = v.epoch_count;
    e.root = p.root;
    e.period_start = p.period_start;
    e.period_end = p.period_end;
    e.claimable_at = now + cfg.dispute_window as i64;
    e.holder_count = p.holder_count;
    e.status = EpochStatus::Open;
    e.legs = legs;
    e.bump = ctx.bumps.epoch;

    emit_cpi!(EpochPublished {
        vault: vault_key,
        epoch: e.key(),
        epoch_id: e.id,
        root: e.root,
        period_start: e.period_start,
        period_end: e.period_end,
        claimable_at: e.claimable_at,
        mints: e.legs.iter().map(|l| l.mint).collect(),
        amounts: p.amounts,
        holder_count: e.holder_count,
    });
    Ok(())
}

/// Creator or admin, latest epoch only, before it becomes claimable.
#[event_cpi]
#[derive(Accounts)]
pub struct CancelEpoch<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [EPOCH_SEED, vault.key().as_ref(), &epoch.id.to_le_bytes()], bump = epoch.bump, has_one = vault)]
    pub epoch: Account<'info, Epoch>,
}

pub fn handle_cancel_epoch(ctx: Context<CancelEpoch>) -> Result<()> {
    let caller = ctx.accounts.caller.key();
    require!(caller == ctx.accounts.vault.creator || caller == ctx.accounts.config.admin, VaultError::Unauthorized);
    let now = Clock::get()?.unix_timestamp;
    let vault_key = ctx.accounts.vault.key();
    let v = &mut ctx.accounts.vault;
    let e = &mut ctx.accounts.epoch;
    require!(e.status == EpochStatus::Open, VaultError::EpochNotOpen);
    require!(e.id == v.epoch_count && now < e.claimable_at, VaultError::EpochNotCancellable);
    for (i, el) in e.legs.iter().enumerate() {
        let l = &mut v.legs[i];
        l.allocated = l.allocated.checked_sub(el.amount).ok_or(VaultError::Overflow)?;
        l.unallocated = l.unallocated.checked_add(el.amount).ok_or(VaultError::Overflow)?;
    }
    e.status = EpochStatus::Cancelled;
    v.last_period_end = e.period_start;
    emit_cpi!(EpochCancelled { vault: vault_key, epoch_id: e.id });
    Ok(())
}

/// Permissionless once the claim window closed; unclaimed amounts roll into the next epoch.
#[event_cpi]
#[derive(Accounts)]
pub struct ExpireEpoch<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [EPOCH_SEED, vault.key().as_ref(), &epoch.id.to_le_bytes()], bump = epoch.bump, has_one = vault)]
    pub epoch: Account<'info, Epoch>,
}

pub fn handle_expire_epoch(ctx: Context<ExpireEpoch>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault_key = ctx.accounts.vault.key();
    let v = &mut ctx.accounts.vault;
    let e = &mut ctx.accounts.epoch;
    require!(e.status == EpochStatus::Open, VaultError::EpochNotOpen);
    require!(now >= e.claimable_at + ctx.accounts.config.claim_window as i64, VaultError::EpochNotExpirable);
    let mut returned = Vec::with_capacity(e.legs.len());
    for (i, el) in e.legs.iter().enumerate() {
        let left = el.amount.checked_sub(el.claimed_total).ok_or(VaultError::Overflow)?;
        returned.push(left);
        let l = &mut v.legs[i];
        l.allocated = l.allocated.checked_sub(left).ok_or(VaultError::Overflow)?;
        l.unallocated = l.unallocated.checked_add(left).ok_or(VaultError::Overflow)?;
    }
    e.status = EpochStatus::Expired;
    emit_cpi!(EpochExpired { vault: vault_key, epoch_id: e.id, returned });
    Ok(())
}
