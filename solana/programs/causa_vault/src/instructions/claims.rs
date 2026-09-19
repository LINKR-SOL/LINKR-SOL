use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::VaultError, events::*, merkle, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimParams {
    pub epoch_id: u64,
    /// Per epoch leg, in basket order.
    pub amounts: Vec<u64>,
    pub proof: Vec<[u8; 32]>,
}

/// Anyone may pay to deliver a holder's payout (the keeper does when the creator enabled auto-claim); the
/// tokens always go to `account`'s ATA. Remaining accounts, for every leg with a non-zero amount, in basket
/// order: [mint, vault ATA, recipient ATA, token program]. Recipient ATAs must exist (create them idempotently
/// in the same transaction).
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: ClaimParams)]
pub struct Claim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [EPOCH_SEED, vault.key().as_ref(), &params.epoch_id.to_le_bytes()], bump = epoch.bump, has_one = vault)]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: the holder; only used as the ATA owner and Merkle leaf key.
    pub account: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + ClaimStatus::INIT_SPACE,
        seeds = [CLAIM_SEED, epoch.key().as_ref(), account.key().as_ref()],
        bump
    )]
    pub claim_status: Account<'info, ClaimStatus>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim<'info>(ctx: Context<'info,Claim<'info>>, p: ClaimParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault_key = ctx.accounts.vault.key();
    let account = ctx.accounts.account.key();
    {
        let e = &ctx.accounts.epoch;
        require!(e.status == EpochStatus::Open, VaultError::EpochNotOpen);
        require!(now >= e.claimable_at, VaultError::EpochNotClaimable);
        require!(p.amounts.len() == e.legs.len(), VaultError::LengthMismatch);
        let leaf = merkle::leaf_hash(e.id, &account.to_bytes(), &p.amounts);
        require!(merkle::verify(&p.proof, &e.root, leaf), VaultError::InvalidProof);
    }
    let nonzero = p.amounts.iter().filter(|a| **a > 0).count();
    require!(ctx.remaining_accounts.len() == nonzero * 4, VaultError::LengthMismatch);

    let salt = ctx.accounts.vault.salt.to_le_bytes();
    let creator = ctx.accounts.vault.creator;
    let bump = ctx.accounts.vault.bump;
    let seeds: &[&[u8]] = &[VAULT_SEED, creator.as_ref(), &salt, &[bump]];

    let mut k = 0usize;
    for i in 0..p.amounts.len() {
        let a = p.amounts[i];
        if a == 0 {
            continue;
        }
        let (mint_info, vault_ata_info, to_ata_info, program_info) = (
            &ctx.remaining_accounts[k * 4],
            &ctx.remaining_accounts[k * 4 + 1],
            &ctx.remaining_accounts[k * 4 + 2],
            &ctx.remaining_accounts[k * 4 + 3],
        );
        k += 1;

        let leg = ctx.accounts.vault.legs[i];
        require_keys_eq!(mint_info.key(), leg.mint, VaultError::WrongLegAccount);
        require_keys_eq!(program_info.key(), leg.token_program, VaultError::WrongLegAccount);
        let expected_vault_ata = get_associated_token_address_with_program_id(&vault_key, &leg.mint, &leg.token_program);
        require_keys_eq!(vault_ata_info.key(), expected_vault_ata, VaultError::WrongLegAccount);
        let expected_to_ata = get_associated_token_address_with_program_id(&account, &leg.mint, &leg.token_program);
        require_keys_eq!(to_ata_info.key(), expected_to_ata, VaultError::WrongLegAccount);
        let mint: InterfaceAccount<Mint> = InterfaceAccount::try_from(mint_info)?;
        let _to: InterfaceAccount<TokenAccount> = InterfaceAccount::try_from(to_ata_info)?;
        let program: Interface<TokenInterface> = Interface::try_from(program_info)?;

        {
            let e = &mut ctx.accounts.epoch;
            let el = &mut e.legs[i];
            let total = el.claimed_total.checked_add(a).ok_or(VaultError::Overflow)?;
            require!(total <= el.amount, VaultError::EpochOverclaim);
            el.claimed_total = total;
        }
        {
            let l = &mut ctx.accounts.vault.legs[i];
            l.allocated = l.allocated.checked_sub(a).ok_or(VaultError::Overflow)?;
        }

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                program.key(),
                TransferChecked {
                    from: vault_ata_info.clone(),
                    mint: mint_info.clone(),
                    to: to_ata_info.clone(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            a,
            mint.decimals,
        )?;
    }

    let cs = &mut ctx.accounts.claim_status;
    cs.epoch = ctx.accounts.epoch.key();
    cs.account = account;
    cs.bump = ctx.bumps.claim_status;

    emit_cpi!(Claimed { vault: vault_key, epoch_id: p.epoch_id, account, amounts: p.amounts });
    Ok(())
}

/// Admin only. Basket and quote balances are dividends by construction and can never be rescued; anything
/// else that landed in a vault ATA goes to the creator.
#[event_cpi]
#[derive(Accounts)]
pub struct Rescue<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = vault.creator, token::token_program = token_program)]
    pub creator_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_rescue(ctx: Context<Rescue>) -> Result<()> {
    let v = &ctx.accounts.vault;
    let mint = ctx.accounts.mint.key();
    require!(mint != v.quote_mint && v.leg_index(&mint).is_none(), VaultError::TokenNotRescuable);
    let amount = ctx.accounts.vault_ata.amount;
    let salt = v.salt.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, v.creator.as_ref(), &salt, &[v.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.creator_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    emit_cpi!(Rescued { vault: v.key(), mint, to: v.creator, amount });
    Ok(())
}
