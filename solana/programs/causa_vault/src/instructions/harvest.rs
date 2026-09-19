use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_ID};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::VaultError, events::*, state::*};

/// Moves the SOL that pump's permissionless `collect_creator_fee` dropped on the vault PDA (everything above
/// rent) into the vault's wrapped-SOL token account. No CPI happens here: the caller follows this with a plain
/// top-level `sync_native` on the ATA, then `harvest_intake`. (A `sync_native` CPI from inside the same
/// instruction would need the vault in its account list to satisfy the runtime's balance check, and the token
/// program rejects extra accounts.)
#[event_cpi]
#[derive(Accounts)]
pub struct WrapFees<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = quote_token_program
    )]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = vault.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_wrap_fees(ctx: Context<WrapFees>) -> Result<u64> {
    let caller = ctx.accounts.caller.key();
    require!(caller == ctx.accounts.config.operator || caller == ctx.accounts.vault.creator, VaultError::Unauthorized);
    let vault_info = ctx.accounts.vault.to_account_info();
    let rent_min = Rent::get()?.minimum_balance(vault_info.data_len());
    let excess = vault_info.lamports().saturating_sub(rent_min);
    if excess > 0 {
        vault_info.sub_lamports(excess)?;
        ctx.accounts.vault_quote_ata.to_account_info().add_lamports(excess)?;
    }
    Ok(excess)
}

/// Step 1 of a harvest (the old `harvest` steps 1-5 minus the swaps): fold stray basket balances, measure the
/// wrapped SOL that arrived (see `wrap_fees`), take the protocol cut and reserve the rest per leg. The keeper
/// prepends the pump collect instructions, `wrap_fees` and a top-level `sync_native` to this one.
///
/// Remaining accounts: the vault's ATA for every leg, in basket order.
#[event_cpi]
#[derive(Accounts)]
pub struct HarvestIntake<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = quote_token_program
    )]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = config.protocol_recipient,
        token::token_program = quote_token_program
    )]
    pub protocol_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = vault.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_harvest_intake<'info>(
    ctx: Context<'info,HarvestIntake<'info>>,
    max_input: u64,
) -> Result<()> {
    let cfg = &ctx.accounts.config;
    require!(!cfg.paused, VaultError::Paused);
    let caller = ctx.accounts.caller.key();
    {
        let v = &ctx.accounts.vault;
        require!(caller == cfg.operator || caller == v.creator, VaultError::Unauthorized);
        require!(v.is_bound(), VaultError::NotBound);
        require!(!v.swap_in_flight, VaultError::SwapInFlight);
        require!(ctx.remaining_accounts.len() == v.legs.len(), VaultError::LengthMismatch);
    }
    let vault_key = ctx.accounts.vault.key();
    let quote_mint = ctx.accounts.vault.quote_mint;

    // 1. Stray basket balances (donations) become dividends as-is.
    for (i, ata_info) in ctx.remaining_accounts.iter().enumerate() {
        let leg = ctx.accounts.vault.legs[i];
        if leg.mint == quote_mint {
            continue;
        }
        let expected = get_associated_token_address_with_program_id(&vault_key, &leg.mint, &leg.token_program);
        require_keys_eq!(ata_info.key(), expected, VaultError::WrongLegAccount);
        let ata: InterfaceAccount<TokenAccount> = InterfaceAccount::try_from(ata_info)?;
        let acc = leg.accounted()?;
        if ata.amount > acc {
            let l = &mut ctx.accounts.vault.legs[i];
            l.unallocated = l.unallocated.checked_add(ata.amount - acc).ok_or(VaultError::Overflow)?;
        }
    }

    // 2. Measured input: wrapped SOL not already spoken for (see `wrap_fees`), capped by max_input.
    let accounted = ctx.accounts.vault.quote_accounted()?;
    let mut input = ctx.accounts.vault_quote_ata.amount.checked_sub(accounted).ok_or(VaultError::Overflow)?;
    if max_input != 0 && input > max_input {
        input = max_input;
    }
    require!(input > 0, VaultError::NothingToHarvest);

    // 3. Protocol share.
    let cut = (input as u128 * cfg.protocol_share_bps as u128 / BPS as u128) as u64;
    if cut > 0 {
        let salt = ctx.accounts.vault.salt.to_le_bytes();
        let seeds: &[&[u8]] = &[VAULT_SEED, ctx.accounts.vault.creator.as_ref(), &salt, &[ctx.accounts.vault.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_quote_ata.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.protocol_quote_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            cut,
            ctx.accounts.quote_mint.decimals,
        )?;
    }
    let remaining = input - cut;

    // 4. Split by weight; the integer remainder goes to the last leg.
    let v = &mut ctx.accounts.vault;
    let n = v.legs.len();
    let mut spent: u64 = 0;
    let mut leg_inputs = Vec::with_capacity(n);
    for i in 0..n {
        let leg_in = if i == n - 1 {
            remaining - spent
        } else {
            (remaining as u128 * v.legs[i].weight_bps as u128 / BPS as u128) as u64
        };
        spent += leg_in;
        leg_inputs.push(leg_in);
        let l = &mut v.legs[i];
        if l.mint == quote_mint {
            l.unallocated = l.unallocated.checked_add(leg_in).ok_or(VaultError::Overflow)?;
            l.harvested_total = l.harvested_total.checked_add(leg_in).ok_or(VaultError::Overflow)?;
        } else {
            l.pending_swap = l.pending_swap.checked_add(leg_in).ok_or(VaultError::Overflow)?;
        }
    }
    v.input_total = v.input_total.checked_add(input).ok_or(VaultError::Overflow)?;
    v.protocol_cut_total = v.protocol_cut_total.checked_add(cut).ok_or(VaultError::Overflow)?;
    v.harvest_count += 1;

    emit_cpi!(Harvested { vault: vault_key, caller, input, protocol_cut: cut, leg_inputs });
    Ok(())
}

/// Hands one leg's reserved quote to the operator so it can be swapped (by Jupiter, keeper-signed) in the
/// same transaction, and records the leg's pre-swap balance. Refuses to run unless a `swap_settle` for this
/// vault follows later in the transaction, so the quote can never leave without the output being measured.
#[event_cpi]
#[derive(Accounts)]
#[instruction(leg: u8)]
pub struct SwapBegin<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = quote_token_program
    )]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = operator, token::token_program = quote_token_program)]
    pub operator_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = vault.legs[leg as usize].mint @ VaultError::WrongLegAccount)]
    pub leg_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        associated_token::mint = leg_mint,
        associated_token::authority = vault,
        associated_token::token_program = leg_token_program
    )]
    pub vault_leg_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = vault.legs[leg as usize].token_program @ VaultError::WrongLegAccount)]
    pub leg_token_program: Interface<'info, TokenInterface>,
    #[account(address = vault.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
    /// CHECK: the instructions sysvar, address-checked.
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handle_swap_begin(ctx: Context<SwapBegin>, leg: u8) -> Result<()> {
    require!(!ctx.accounts.config.paused, VaultError::Paused);
    let vault_key = ctx.accounts.vault.key();
    let amount = {
        let v = &ctx.accounts.vault;
        require!(v.is_bound(), VaultError::NotBound);
        require!(!v.swap_in_flight, VaultError::SwapInFlight);
        require!((leg as usize) < v.legs.len(), VaultError::BadLeg);
        let l = &v.legs[leg as usize];
        require!(l.mint != v.quote_mint, VaultError::BadLeg);
        require!(l.pending_swap > 0, VaultError::NothingToSwap);
        l.pending_swap
    };

    // A swap_settle for this vault must follow in this very transaction.
    let sysvar = ctx.accounts.instructions_sysvar.to_account_info();
    let current = load_current_index_checked(&sysvar)? as usize;
    let mut found = false;
    let mut i = current + 1;
    while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == crate::ID
            && ix.data.len() >= 8
            && ix.data[..8] == *crate::instruction::SwapSettle::DISCRIMINATOR
            && ix.accounts.iter().any(|m| m.pubkey == vault_key)
        {
            found = true;
            break;
        }
        i += 1;
    }
    require!(found, VaultError::SettleNotInTransaction);

    let salt = ctx.accounts.vault.salt.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, ctx.accounts.vault.creator.as_ref(), &salt, &[ctx.accounts.vault.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_quote_ata.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.operator_quote_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;

    let v = &mut ctx.accounts.vault;
    v.swap_in_flight = true;
    v.swap_leg = leg;
    v.swap_pre_balance = ctx.accounts.vault_leg_ata.amount;
    Ok(())
}

/// Measures what the swap delivered to the vault's leg ATA and books it. Never trusts the swap's own output.
#[event_cpi]
#[derive(Accounts)]
#[instruction(leg: u8)]
pub struct SwapSettle<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED, vault.creator.as_ref(), &vault.salt.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.legs[leg as usize].mint @ VaultError::WrongLegAccount)]
    pub leg_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        associated_token::mint = leg_mint,
        associated_token::authority = vault,
        associated_token::token_program = leg_token_program
    )]
    pub vault_leg_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = vault.legs[leg as usize].token_program @ VaultError::WrongLegAccount)]
    pub leg_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_swap_settle(ctx: Context<SwapSettle>, leg: u8, min_out: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let v = &mut ctx.accounts.vault;
    require!(v.swap_in_flight && v.swap_leg == leg, VaultError::NoSwapInFlight);
    let got = ctx.accounts.vault_leg_ata.amount.checked_sub(v.swap_pre_balance).ok_or(VaultError::Overflow)?;
    require!(got >= min_out, VaultError::InsufficientOutput);
    let l = &mut v.legs[leg as usize];
    let amount_in = l.pending_swap;
    l.pending_swap = 0;
    l.unallocated = l.unallocated.checked_add(got).ok_or(VaultError::Overflow)?;
    l.harvested_total = l.harvested_total.checked_add(got).ok_or(VaultError::Overflow)?;
    let mint = l.mint;
    v.swap_in_flight = false;
    v.swap_leg = 0;
    v.swap_pre_balance = 0;
    emit_cpi!(SwapSettled { vault: vault_key, leg, mint, amount_in, amount_out: got });
    Ok(())
}
