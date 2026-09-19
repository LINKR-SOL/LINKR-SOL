use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Program is paused")]
    Paused,
    #[msg("Protocol share above the 20% cap")]
    ProtocolShareTooHigh,
    #[msg("Dispute window must be shorter than the minimum epoch length")]
    DisputeWindowTooLong,
    #[msg("Basket must have 1 to 10 legs")]
    BasketLength,
    #[msg("Basket mint is not on the allowlist")]
    MintNotAllowed,
    #[msg("Duplicate basket mint")]
    DuplicateMint,
    #[msg("Basket weights must be non-zero and sum to 10000")]
    WeightsMustSum,
    #[msg("Epoch length below the minimum")]
    EpochLengthTooShort,
    #[msg("Vault is already bound to a launch")]
    AlreadyBound,
    #[msg("Vault is not bound to a launch yet")]
    NotBound,
    #[msg("Bonding curve account is not owned by the pump program")]
    NotPumpAccount,
    #[msg("Bonding curve does not belong to the expected mint")]
    WrongBondingCurve,
    #[msg("Launch creator is not this vault")]
    WrongCreator,
    #[msg("Nothing to harvest")]
    NothingToHarvest,
    #[msg("A swap is already in flight")]
    SwapInFlight,
    #[msg("No swap in flight")]
    NoSwapInFlight,
    #[msg("swap_begin must be followed by swap_settle in the same transaction")]
    SettleNotInTransaction,
    #[msg("Leg index out of range")]
    BadLeg,
    #[msg("Leg has nothing pending to swap")]
    NothingToSwap,
    #[msg("Swap output below minimum")]
    InsufficientOutput,
    #[msg("Basket account does not match the leg")]
    WrongLegAccount,
    #[msg("Epoch period must start where the previous one ended")]
    PeriodMismatch,
    #[msg("Invalid epoch period")]
    InvalidPeriod,
    #[msg("Length mismatch")]
    LengthMismatch,
    #[msg("Not enough unallocated tokens for this epoch")]
    InsufficientUnallocated,
    #[msg("Epoch is not open")]
    EpochNotOpen,
    #[msg("Only the latest epoch can be cancelled, and only before it becomes claimable")]
    EpochNotCancellable,
    #[msg("Epoch claim window has not closed yet")]
    EpochNotExpirable,
    #[msg("Epoch is not claimable yet")]
    EpochNotClaimable,
    #[msg("Invalid Merkle proof")]
    InvalidProof,
    #[msg("Claim exceeds the epoch's declared amount for this token")]
    EpochOverclaim,
    #[msg("Nothing pending for this account and mint")]
    NothingPending,
    #[msg("Basket and quote balances can never be rescued")]
    TokenNotRescuable,
    #[msg("Arithmetic overflow")]
    Overflow,
}
