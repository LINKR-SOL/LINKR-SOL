//! End-to-end lifecycle of one vault on LiteSVM: config → allowlist → create → bind (against a fabricated
//! pump bonding curve) → harvest (fees dropped on the PDA as lamports) → swap (Jupiter mocked by a mint_to
//! between swap_begin and swap_settle) → publish epoch → claim → expire. Also the guards that matter most.
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{get_associated_token_address_with_program_id, spl_associated_token_account},
        token::{spl_token, ID as TOKEN_PROGRAM_ID},
    },
    solana_program_pack::Pack,
    causa_vault::{
        constants::*,
        instruction as ix,
        merkle::{leaf_hash, NODE_PREFIX},
        state::*,
        accounts as acc,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keccak_hasher::hashv,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SOL: u64 = 1_000_000_000;

struct World {
    svm: LiteSVM,
    program_id: Pubkey,
    event_authority: Pubkey,
    admin: Keypair,
    operator: Keypair,
    creator: Keypair,
    protocol_recipient: Keypair,
    mint_a: Pubkey,
    mint_b: Pubkey,
}

impl World {
    fn new() -> Self {
        let program_id = causa_vault::id();
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/causa_vault.so"));
        svm.add_program(program_id, bytes).unwrap();
        let admin = Keypair::new();
        let operator = Keypair::new();
        let creator = Keypair::new();
        let protocol_recipient = Keypair::new();
        for k in [&admin, &operator, &creator, &protocol_recipient] {
            svm.airdrop(&k.pubkey(), 20 * SOL).unwrap();
        }
        let mut w = World {
            svm,
            program_id,
            event_authority: Pubkey::find_program_address(&[b"__event_authority"], &program_id).0,
            admin,
            operator,
            creator,
            protocol_recipient,
            mint_a: Pubkey::default(),
            mint_b: Pubkey::default(),
        };
        w.ensure_native_mint();
        w.mint_a = w.create_mint(6);
        w.mint_b = w.create_mint(6);
        w
    }

    /// LiteSVM does not pre-create the wrapped-SOL mint; token accounts for it need the mint to exist.
    fn ensure_native_mint(&mut self) {
        let mint = spl_token::state::Mint { mint_authority: None.into(), supply: 0, decimals: 9, is_initialized: true, freeze_authority: None.into() };
        let mut data = vec![0u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint::pack(mint, &mut data).unwrap();
        self.svm
            .set_account(
                WSOL_MINT,
                Account { lamports: self.svm.minimum_balance_for_rent_exemption(data.len()), data, owner: TOKEN_PROGRAM_ID, executable: false, rent_epoch: 0 },
            )
            .unwrap();
    }

    fn send(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Result<(), String> {
        // a fresh blockhash per transaction: the same instructions re-sent after a deliberate failure would
        // otherwise carry the same signature and be rejected as already processed
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
        match self.svm.send_transaction(tx) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("{:?}\n{}", e.err, e.meta.logs.join("\n"))),
        }
    }

    fn must(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) {
        if let Err(e) = self.send(ixs, payer, extra) {
            panic!("transaction failed:\n{e}");
        }
    }

    fn expect_err(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair], needle: &str) {
        match self.send(ixs, payer, extra) {
            Ok(()) => panic!("expected failure containing {needle:?}"),
            Err(e) => assert!(e.contains(needle), "expected {needle:?} in:\n{e}"),
        }
    }

    fn create_mint(&mut self, decimals: u8) -> Pubkey {
        let mint = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
        let create = solana_system_interface::instruction::create_account(
            &self.admin.pubkey(), &mint.pubkey(), rent, spl_token::state::Mint::LEN as u64, &TOKEN_PROGRAM_ID,
        );
        let init = spl_token::instruction::initialize_mint2(&TOKEN_PROGRAM_ID, &mint.pubkey(), &self.admin.pubkey(), None, decimals).unwrap();
        let admin = self.admin.insecure_clone();
        self.must(&[create, init], &admin, &[&mint]);
        mint.pubkey()
    }

    fn create_ata(&mut self, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        let payer = self.admin.insecure_clone();
        let ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&payer.pubkey(), owner, mint, &TOKEN_PROGRAM_ID);
        self.must(&[ix], &payer, &[]);
        get_associated_token_address_with_program_id(owner, mint, &TOKEN_PROGRAM_ID)
    }

    fn mint_to_ix(&self, mint: &Pubkey, to: &Pubkey, amount: u64) -> Instruction {
        spl_token::instruction::mint_to(&TOKEN_PROGRAM_ID, mint, to, &self.admin.pubkey(), &[], amount).unwrap()
    }

    fn token_amount(&self, ata: &Pubkey) -> u64 {
        let a = self.svm.get_account(ata).expect("token account");
        spl_token::state::Account::unpack(&a.data).unwrap().amount
    }

    fn account<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let a = self.svm.get_account(key).expect("account");
        T::try_deserialize(&mut &a.data[..]).unwrap()
    }

    fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    fn warp(&mut self, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += seconds;
        clock.slot += (seconds as u64) * 2;
        self.svm.set_sysvar(&clock);
    }

    fn ix(&self, accounts: impl ToAccountMetas, data: impl InstructionData, remaining: Vec<anchor_lang::solana_program::instruction::AccountMeta>) -> Instruction {
        let mut metas = accounts.to_account_metas(None);
        metas.extend(remaining);
        Instruction::new_with_bytes(self.program_id, &data.data(), metas)
    }

    fn config_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[CONFIG_SEED], &self.program_id).0
    }

    fn basket_pda(&self, mint: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[BASKET_SEED, mint.as_ref()], &self.program_id).0
    }

    fn vault_pda(&self, creator: &Pubkey, salt: u64) -> Pubkey {
        Pubkey::find_program_address(&[VAULT_SEED, creator.as_ref(), &salt.to_le_bytes()], &self.program_id).0
    }

    fn epoch_pda(&self, vault: &Pubkey, id: u64) -> Pubkey {
        Pubkey::find_program_address(&[EPOCH_SEED, vault.as_ref(), &id.to_le_bytes()], &self.program_id).0
    }

    fn claim_pda(&self, epoch: &Pubkey, account: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[CLAIM_SEED, epoch.as_ref(), account.as_ref()], &self.program_id).0
    }

    /// Plants a pump.fun `BondingCurve` account naming `creator`, exactly as pump would lay it out.
    fn plant_bonding_curve(&mut self, mint: &Pubkey, creator: &Pubkey) -> Pubkey {
        let curve = Pubkey::find_program_address(&[PUMP_BONDING_CURVE_SEED, mint.as_ref()], &PUMP_PROGRAM_ID).0;
        let mut data = Vec::with_capacity(115);
        data.extend_from_slice(&PUMP_BONDING_CURVE_DISCRIMINATOR);
        for v in [1_073_000_000_000_000u64, 30_000_000_000, 793_100_000_000_000, 0, 1_000_000_000_000_000] {
            data.extend_from_slice(&v.to_le_bytes());
        }
        data.push(0); // complete
        data.extend_from_slice(creator.as_ref());
        data.push(0); // is_mayhem_mode
        data.push(0); // is_cashback_coin
        data.extend_from_slice(WSOL_MINT.as_ref());
        self.svm
            .set_account(curve, Account { lamports: SOL, data, owner: PUMP_PROGRAM_ID, executable: false, rent_epoch: 0 })
            .unwrap();
        curve
    }
}

fn root_of_two(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    hashv(&[NODE_PREFIX, &lo, &hi]).to_bytes()
}

#[test]
fn full_vault_lifecycle() {
    let mut w = World::new();
    let config = w.config_pda();
    let (admin, operator, creator) = (w.admin.insecure_clone(), w.operator.insecure_clone(), w.creator.insecure_clone());

    // --- config + allowlist ---
    let init = w.ix(
        acc::InitConfig { admin: admin.pubkey(), config, system_program: system_program::ID, event_authority: w.event_authority, program: w.program_id },
        ix::InitConfig {
            params: causa_vault::InitConfigParams {
                operator: operator.pubkey(),
                protocol_share_bps: 500,
                protocol_recipient: w.protocol_recipient.pubkey(),
                dispute_window: 60,
                claim_window: 3_600,
                min_epoch_length: 120,
            },
        },
        vec![],
    );
    w.must(&[init], &admin, &[]);
    let cfg: Config = w.account(&config);
    assert_eq!(cfg.operator, operator.pubkey());
    assert_eq!(cfg.protocol_share_bps, 500);

    for mint in [w.mint_a, w.mint_b] {
        let allow = w.ix(
            acc::AllowBasketMint {
                admin: admin.pubkey(), config, mint, token_program: TOKEN_PROGRAM_ID, basket: w.basket_pda(&mint),
                system_program: system_program::ID, event_authority: w.event_authority, program: w.program_id,
            },
            ix::AllowBasketMint {},
            vec![],
        );
        w.must(&[allow], &admin, &[]);
    }

    // --- create vault (ATAs for the PDA are created by the client first) ---
    let salt = 7u64;
    let vault = w.vault_pda(&creator.pubkey(), salt);
    let expected_mint = Keypair::new().pubkey();
    let (mint_a, mint_b) = (w.mint_a, w.mint_b);
    let vault_wsol = w.create_ata(&vault, &WSOL_MINT);
    let vault_a = w.create_ata(&vault, &mint_a);
    let vault_b = w.create_ata(&vault, &mint_b);
    let remaining = |w: &World| {
        use anchor_lang::solana_program::instruction::AccountMeta;
        vec![
            AccountMeta::new_readonly(mint_a, false), AccountMeta::new_readonly(w.basket_pda(&mint_a), false), AccountMeta::new_readonly(vault_a, false),
            AccountMeta::new_readonly(mint_b, false), AccountMeta::new_readonly(w.basket_pda(&mint_b), false), AccountMeta::new_readonly(vault_b, false),
        ]
    };
    let create = w.ix(
        acc::CreateVault {
            creator: creator.pubkey(), config, vault, quote_mint: WSOL_MINT, vault_quote_ata: vault_wsol, quote_token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID, event_authority: w.event_authority, program: w.program_id,
        },
        ix::CreateVault { params: causa_vault::CreateVaultParams { salt, weights_bps: vec![7_000, 3_000], epoch_length: 120, expected_mint } },
        remaining(&w),
    );
    w.must(&[create], &creator, &[]);
    let v: Vault = w.account(&vault);
    assert_eq!(v.legs.len(), 2);
    assert_eq!(v.expected_mint, expected_mint);
    assert!(!v.is_bound());

    // weights that do not sum to 10000 are rejected
    let vault8 = w.vault_pda(&creator.pubkey(), 8);
    let vault8_wsol = w.create_ata(&vault8, &WSOL_MINT);
    let bad = w.ix(
        acc::CreateVault {
            creator: creator.pubkey(), config, vault: vault8, quote_mint: WSOL_MINT, vault_quote_ata: vault8_wsol,
            quote_token_program: TOKEN_PROGRAM_ID, system_program: system_program::ID, event_authority: w.event_authority, program: w.program_id,
        },
        ix::CreateVault { params: causa_vault::CreateVaultParams { salt: 8, weights_bps: vec![7_000, 2_000], epoch_length: 120, expected_mint } },
        remaining(&w),
    );
    w.expect_err(&[bad], &creator, &[], "WeightsMustSum");

    // --- bind against a fabricated pump curve ---
    let wrong_curve = w.plant_bonding_curve(&expected_mint, &creator.pubkey());
    let bind = w.ix(acc::BindLaunch { vault, bonding_curve: wrong_curve, event_authority: w.event_authority, program: w.program_id }, ix::BindLaunch {}, vec![]);
    w.expect_err(&[bind], &admin, &[], "WrongCreator");
    let curve = w.plant_bonding_curve(&expected_mint, &vault);
    let bind = w.ix(acc::BindLaunch { vault, bonding_curve: curve, event_authority: w.event_authority, program: w.program_id }, ix::BindLaunch {}, vec![]);
    w.must(&[bind], &admin, &[]);
    let v: Vault = w.account(&vault);
    assert_eq!(v.launch_mint, expected_mint);
    let bound_at = v.bound_at;

    // --- harvest: pump's collect drops lamports on the PDA; intake wraps them and reserves per leg ---
    w.svm.airdrop(&vault, SOL).unwrap();
    let protocol_wsol = w.create_ata(&w.protocol_recipient.pubkey(), &WSOL_MINT);
    let intake_accounts = |w: &World| acc::HarvestIntake {
        caller: w.operator.pubkey(), config, vault, quote_mint: WSOL_MINT, vault_quote_ata: vault_wsol, protocol_quote_ata: protocol_wsol,
        quote_token_program: TOKEN_PROGRAM_ID, event_authority: w.event_authority, program: w.program_id,
    };
    let leg_atas = || {
        use anchor_lang::solana_program::instruction::AccountMeta;
        vec![AccountMeta::new_readonly(vault_a, false), AccountMeta::new_readonly(vault_b, false)]
    };
    let wrap = |w: &World| w.ix(
        acc::WrapFees { caller: w.operator.pubkey(), config, vault, quote_mint: WSOL_MINT, vault_quote_ata: vault_wsol, quote_token_program: TOKEN_PROGRAM_ID, event_authority: w.event_authority, program: w.program_id },
        ix::WrapFees {},
        vec![],
    );
    let sync = spl_token::instruction::sync_native(&TOKEN_PROGRAM_ID, &vault_wsol).unwrap();
    // intake without the wrap + sync: nothing measurable yet
    let intake = w.ix(intake_accounts(&w), ix::HarvestIntake { max_input: 0 }, leg_atas());
    w.expect_err(&[intake], &operator, &[], "NothingToHarvest");
    let intake = w.ix(intake_accounts(&w), ix::HarvestIntake { max_input: 0 }, leg_atas());
    w.must(&[wrap(&w), sync.clone(), intake], &operator, &[]);
    let v: Vault = w.account(&vault);
    let cut = SOL * 500 / 10_000;
    let net = SOL - cut;
    assert_eq!(w.token_amount(&protocol_wsol), cut);
    assert_eq!(w.token_amount(&vault_wsol), net);
    assert_eq!(v.legs[0].pending_swap, net * 7_000 / 10_000);
    assert_eq!(v.legs[1].pending_swap, net - net * 7_000 / 10_000);
    assert_eq!(v.input_total, SOL);
    // nothing new to harvest now (wrap moves nothing, sync is a no-op)
    let intake = w.ix(intake_accounts(&w), ix::HarvestIntake { max_input: 0 }, leg_atas());
    w.expect_err(&[wrap(&w), sync, intake], &operator, &[], "NothingToHarvest");

    // --- swaps: begin must be followed by settle in the same tx; output measured from the ATA delta ---
    let operator_wsol = w.create_ata(&operator.pubkey(), &WSOL_MINT);
    let begin = |w: &World, leg: u8, mint: Pubkey, vault_leg_ata: Pubkey| {
        w.ix(
            acc::SwapBegin {
                operator: w.operator.pubkey(), config, vault, quote_mint: WSOL_MINT, vault_quote_ata: vault_wsol, operator_quote_ata: operator_wsol,
                leg_mint: mint, vault_leg_ata, leg_token_program: TOKEN_PROGRAM_ID, quote_token_program: TOKEN_PROGRAM_ID,
                instructions_sysvar: solana_instructions_sysvar::ID, event_authority: w.event_authority, program: w.program_id,
            },
            ix::SwapBegin { leg },
            vec![],
        )
    };
    let settle = |w: &World, leg: u8, mint: Pubkey, vault_leg_ata: Pubkey, min_out: u64| {
        w.ix(
            acc::SwapSettle {
                operator: w.operator.pubkey(), config, vault, leg_mint: mint, vault_leg_ata, leg_token_program: TOKEN_PROGRAM_ID,
                event_authority: w.event_authority, program: w.program_id,
            },
            ix::SwapSettle { leg, min_out },
            vec![],
        )
    };
    // begin alone: refused
    w.expect_err(&[begin(&w, 0, mint_a, vault_a)], &operator, &[], "SettleNotInTransaction");
    // begin + short output: refused, nothing leaves the vault
    let ixs = [begin(&w, 0, mint_a, vault_a), w.mint_to_ix(&mint_a, &vault_a, 10), settle(&w, 0, mint_a, vault_a, 1_000_000)];
    w.expect_err(&ixs, &operator, &[&admin], "InsufficientOutput");
    assert_eq!(w.token_amount(&vault_wsol), net);
    // the real thing
    let out_a = 1_000_000u64;
    let ixs = [begin(&w, 0, mint_a, vault_a), w.mint_to_ix(&mint_a, &vault_a, out_a), settle(&w, 0, mint_a, vault_a, out_a)];
    w.must(&ixs, &operator, &[&admin]);
    let v: Vault = w.account(&vault);
    assert_eq!(v.legs[0].unallocated, out_a);
    assert_eq!(v.legs[0].pending_swap, 0);
    assert!(!v.swap_in_flight);
    assert_eq!(w.token_amount(&operator_wsol), net * 7_000 / 10_000);
    let out_b = 500_000u64;
    let ixs = [begin(&w, 1, mint_b, vault_b), w.mint_to_ix(&mint_b, &vault_b, out_b), settle(&w, 1, mint_b, vault_b, out_b)];
    w.must(&ixs, &operator, &[&admin]);
    let v: Vault = w.account(&vault);
    assert_eq!(v.legs[1].unallocated, out_b);
    assert_eq!(w.token_amount(&vault_wsol), 0);

    // --- epoch: two holders, 60/40 ---
    let holder1 = Keypair::new();
    let holder2 = Keypair::new();
    let amounts1 = [600_000u64, 300_000];
    let amounts2 = [400_000u64, 200_000];
    let leaf1 = leaf_hash(1, &holder1.pubkey().to_bytes(), &amounts1);
    let leaf2 = leaf_hash(1, &holder2.pubkey().to_bytes(), &amounts2);
    let root = root_of_two(leaf1, leaf2);
    let epoch = w.epoch_pda(&vault, 1);
    let publish = |w: &World, period_start: i64, period_end: i64| {
        w.ix(
            acc::PublishEpoch { operator: w.operator.pubkey(), config, vault, epoch, system_program: system_program::ID, event_authority: w.event_authority, program: w.program_id },
            ix::PublishEpoch { params: causa_vault::PublishEpochParams { root, amounts: vec![out_a, out_b], period_start, period_end, holder_count: 2 } },
            vec![],
        )
    };
    // too early: the period is shorter than epoch_length
    w.expect_err(&[publish(&w, bound_at, w.now())], &operator, &[], "InvalidPeriod");
    w.warp(200);
    let period_end = w.now();
    w.expect_err(&[publish(&w, bound_at + 1, period_end)], &operator, &[], "PeriodMismatch");
    w.must(&[publish(&w, bound_at, period_end)], &operator, &[]);
    let e: Epoch = w.account(&epoch);
    assert_eq!(e.id, 1);
    assert_eq!(e.legs[0].amount, out_a);
    let v: Vault = w.account(&vault);
    assert_eq!(v.legs[0].allocated, out_a);
    assert_eq!(v.legs[0].unallocated, 0);
    assert_eq!(v.last_period_end, period_end);

    // --- claim ---
    let h1_a = w.create_ata(&holder1.pubkey(), &mint_a);
    let h1_b = w.create_ata(&holder1.pubkey(), &mint_b);
    let claim_ix = |w: &World, holder: &Pubkey, amounts: [u64; 2], proof: [u8; 32], ata_a: Pubkey, ata_b: Pubkey| {
        use anchor_lang::solana_program::instruction::AccountMeta;
        w.ix(
            acc::Claim {
                payer: w.admin.pubkey(), config, vault, epoch, account: *holder, claim_status: w.claim_pda(&epoch, holder),
                system_program: system_program::ID, event_authority: w.event_authority, program: w.program_id,
            },
            ix::Claim { params: causa_vault::ClaimParams { epoch_id: 1, amounts: amounts.to_vec(), proof: vec![proof] } },
            vec![
                AccountMeta::new_readonly(mint_a, false), AccountMeta::new(vault_a, false), AccountMeta::new(ata_a, false), AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
                AccountMeta::new_readonly(mint_b, false), AccountMeta::new(vault_b, false), AccountMeta::new(ata_b, false), AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            ],
        )
    };
    // dispute window still open
    w.expect_err(&[claim_ix(&w, &holder1.pubkey(), amounts1, leaf2, h1_a, h1_b)], &admin, &[], "EpochNotClaimable");
    // creator may cancel during the window
    let cancel = w.ix(acc::CancelEpoch { caller: creator.pubkey(), config, vault, epoch, event_authority: w.event_authority, program: w.program_id }, ix::CancelEpoch {}, vec![]);
    // …but a stranger may not
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let cancel_by_stranger = w.ix(acc::CancelEpoch { caller: stranger.pubkey(), config, vault, epoch, event_authority: w.event_authority, program: w.program_id }, ix::CancelEpoch {}, vec![]);
    w.expect_err(&[cancel_by_stranger], &stranger, &[], "Unauthorized");
    w.warp(61);
    w.expect_err(&[cancel], &creator, &[], "EpochNotCancellable");
    // wrong amounts: bad proof
    w.expect_err(&[claim_ix(&w, &holder1.pubkey(), [600_001, 300_000], leaf2, h1_a, h1_b)], &admin, &[], "InvalidProof");
    // anyone can pay to deliver holder1's payout; it lands in holder1's ATAs
    w.must(&[claim_ix(&w, &holder1.pubkey(), amounts1, leaf2, h1_a, h1_b)], &admin, &[]);
    assert_eq!(w.token_amount(&h1_a), 600_000);
    assert_eq!(w.token_amount(&h1_b), 300_000);
    let v: Vault = w.account(&vault);
    assert_eq!(v.legs[0].allocated, out_a - 600_000);
    // double claim: the claim-status PDA already exists
    let r = w.send(&[claim_ix(&w, &holder1.pubkey(), amounts1, leaf2, h1_a, h1_b)], &admin, &[]);
    assert!(r.is_err(), "double claim must fail");

    // --- expire: holder2 never claimed; their share rolls back into unallocated ---
    let expire = w.ix(acc::ExpireEpoch { config, vault, epoch, event_authority: w.event_authority, program: w.program_id }, ix::ExpireEpoch {}, vec![]);
    w.expect_err(&[expire.clone()], &admin, &[], "EpochNotExpirable");
    w.warp(3_600);
    w.must(&[expire], &admin, &[]);
    let v: Vault = w.account(&vault);
    let e: Epoch = w.account(&epoch);
    assert_eq!(e.status, EpochStatus::Expired);
    assert_eq!(v.legs[0].allocated, 0);
    assert_eq!(v.legs[0].unallocated, out_a - 600_000);
    assert_eq!(v.legs[1].unallocated, out_b - 300_000);
    // invariant: the vault never books more than it holds
    for (leg, ata) in [(0usize, vault_a), (1, vault_b)] {
        assert!(w.token_amount(&ata) >= v.legs[leg].unallocated + v.legs[leg].allocated);
    }

    // a claim on an expired epoch is refused
    let h2_a = w.create_ata(&holder2.pubkey(), &mint_a);
    let h2_b = w.create_ata(&holder2.pubkey(), &mint_b);
    w.expect_err(&[claim_ix(&w, &holder2.pubkey(), amounts2, leaf1, h2_a, h2_b)], &admin, &[], "EpochNotOpen");

    // --- admin guards ---
    let update = w.ix(
        acc::AdminOnly { admin: stranger.pubkey(), config, event_authority: w.event_authority, program: w.program_id },
        ix::UpdateConfig { params: causa_vault::UpdateConfigParams { paused: Some(true), ..Default::default() } },
        vec![],
    );
    w.expect_err(&[update], &stranger, &[], "Unauthorized");
    let update = w.ix(
        acc::AdminOnly { admin: admin.pubkey(), config, event_authority: w.event_authority, program: w.program_id },
        ix::UpdateConfig { params: causa_vault::UpdateConfigParams { protocol_share_bps: Some(2_001), ..Default::default() } },
        vec![],
    );
    w.expect_err(&[update], &admin, &[], "ProtocolShareTooHigh");
}
