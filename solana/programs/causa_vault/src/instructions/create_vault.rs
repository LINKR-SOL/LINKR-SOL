use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{constants::*, error::VaultError, events::*, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateVaultParams {
    pub salt: u64,
    pub weights_bps: Vec<u16>,
    pub epoch_length: u32,
    /// The pump mint the creator will launch with this vault as `creator`.
    pub expected_mint: Pubkey,
}

/// Remaining accounts, per basket leg: [mint, allowed-basket PDA, vault ATA for that mint].
/// Every ATA (legs and quote) is created by the client beforehand with the vault PDA as owner.
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: CreateVaultParams)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = creator,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, creator.key().as_ref(), &params.salt.to_le_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(address = WSOL_MINT, mint::token_program = quote_token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = quote_token_program
    )]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_vault<'info>(
    ctx: Context<'info,CreateVault<'info>>,
    params: CreateVaultParams,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, VaultError::Paused);
    let n = params.weights_bps.len();
    require!(n >= 1 && n <= MAX_BASKET as usize, VaultError::BasketLength);
    require!(ctx.remaining_accounts.len() == n * 3, VaultError::LengthMismatch);
    require!(params.epoch_length >= ctx.accounts.config.min_epoch_length, VaultError::EpochLengthTooShort);
    require!(params.expected_mint != Pubkey::default(), VaultError::WrongBondingCurve);
    // cheap parameter checks before any account is touched
    let mut sum: u32 = 0;
    for w in &params.weights_bps {
        require!(*w > 0, VaultError::WeightsMustSum);
        sum += *w as u32;
    }
    require!(sum == BPS as u32, VaultError::WeightsMustSum);

    let vault_key = ctx.accounts.vault.key();
    let mut legs: Vec<Leg> = Vec::with_capacity(n);
    for i in 0..n {
        let mint_info = &ctx.remaining_accounts[i * 3];
        let basket_info = &ctx.remaining_accounts[i * 3 + 1];
        let ata_info = &ctx.remaining_accounts[i * 3 + 2];
        let w = params.weights_bps[i];
        require!(!legs.iter().any(|l| l.mint == mint_info.key()), VaultError::DuplicateMint);

        // allowlist marker must be our PDA for this mint
        let (expected_basket, _) = Pubkey::find_program_address(&[BASKET_SEED, mint_info.key().as_ref()], &crate::ID);
        require_keys_eq!(basket_info.key(), expected_basket, VaultError::MintNotAllowed);
        require_keys_eq!(*basket_info.owner, crate::ID, VaultError::MintNotAllowed);
        let allowed: Account<AllowedBasketMint> = Account::try_from(basket_info)?;

        // the vault's ATA for this mint must already exist and be owned by the vault
        let expected_ata = get_associated_token_address_with_program_id(&vault_key, &allowed.mint, &allowed.token_program);
        require_keys_eq!(ata_info.key(), expected_ata, VaultError::WrongLegAccount);
        let ata: InterfaceAccount<TokenAccount> = InterfaceAccount::try_from(ata_info)?;
        require_keys_eq!(ata.owner, vault_key, VaultError::WrongLegAccount);
        require_keys_eq!(ata.mint, allowed.mint, VaultError::WrongLegAccount);

        legs.push(Leg {
            mint: allowed.mint,
            token_program: allowed.token_program,
            decimals: allowed.decimals,
            weight_bps: w,
            ..Default::default()
        });
    }

    let now = Clock::get()?.unix_timestamp;
    let v = &mut ctx.accounts.vault;
    v.creator = ctx.accounts.creator.key();
    v.salt = params.salt;
    v.bump = ctx.bumps.vault;
    v.expected_mint = params.expected_mint;
    v.launch_mint = Pubkey::default();
    v.quote_mint = ctx.accounts.quote_mint.key();
    v.quote_token_program = ctx.accounts.quote_token_program.key();
    v.epoch_length = params.epoch_length;
    v.bound_at = 0;
    v.last_period_end = now;
    v.legs = legs;
    ctx.accounts.config.vault_count += 1;

    emit_cpi!(VaultCreated {
        vault: vault_key,
        creator: v.creator,
        salt: v.salt,
        expected_mint: v.expected_mint,
        quote_mint: v.quote_mint,
        mints: v.legs.iter().map(|l| l.mint).collect(),
        weights_bps: v.legs.iter().map(|l| l.weight_bps).collect(),
        epoch_length: v.epoch_length,
    });
    Ok(())
}

/// Anyone may bind once the pump curve exists and names this vault as creator. No signer needed.
#[event_cpi]
#[derive(Accounts)]
pub struct BindLaunch<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: owner, discriminator and PDA derivation are verified in the handler.
    pub bonding_curve: UncheckedAccount<'info>,
}

pub fn handle_bind_launch(ctx: Context<BindLaunch>) -> Result<()> {
    let v = &mut ctx.accounts.vault;
    require!(!v.is_bound(), VaultError::AlreadyBound);
    let curve = ctx.accounts.bonding_curve.key();
    require!(pump_bonding_curve_pdas(&v.expected_mint).contains(&curve), VaultError::WrongBondingCurve);
    let creator = pump_bonding_curve_creator(&ctx.accounts.bonding_curve.to_account_info())?;
    require_keys_eq!(creator, v.key(), VaultError::WrongCreator);

    let now = Clock::get()?.unix_timestamp;
    v.launch_mint = v.expected_mint;
    v.bound_at = now;
    v.last_period_end = now;
    emit_cpi!(LaunchBound { vault: v.key(), mint: v.launch_mint, bonding_curve: curve, bound_at: now });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetAutoClaim<'info> {
    pub creator: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump, has_one = creator @ VaultError::Unauthorized)]
    pub vault: Account<'info, Vault>,
}

pub fn handle_set_auto_claim(ctx: Context<SetAutoClaim>, enabled: bool) -> Result<()> {
    ctx.accounts.vault.auto_claim = enabled;
    emit_cpi!(AutoClaimUpdated { vault: ctx.accounts.vault.key(), enabled });
    Ok(())
}
