# LINKR — audit checklist

Scope: the `causa_vault` Anchor program (`solana/programs/causa_vault`), the custodial keeper
(`web/lib/custody`), the shared payout builder (`web/lib/indexer/epochBuild.ts`, `web/lib/dividends`) and the
wallet-signed action layer. Coin liquidity lives on StonkFun (Raydium LaunchLab, then a Raydium CPMM pool) and is
out of scope.

## Invariants the tests already enforce (keep them green)

- Per basket leg: `token_account.amount ≥ unallocated + allocated` (plus `pending_swap` in the quote token before the swap).
- An epoch can never pay out more per leg than it declared; `claimed_totals ≤ amounts`.
- A `(epoch, account)` claim happens once (`ClaimStatus` PDA / `claimed` leaf).
- `publish_epoch` requires `period_start == last_period_end`; periods never overlap or skip.
- Cancel and expire return exactly `amounts − claimed_totals` to the pot.
- TS and Rust Merkle builders produce identical roots for the same leaves (vitest + LiteSVM).

Run: `cd solana && cargo test -p causa_vault` · `cd web && npm test` · `npm run e2e:devnet` (devnet, LaunchLab).

## Program (`program` mode)

The program is unchanged by the StonkFun migration: `bind_launch` still parses pump.fun's bonding curve, so
program mode is deferred until a LaunchLab-aware build. Custodial mode is the supported mode today.

1. **`swap_begin` / `swap_settle` atomicity.** Instruction introspection must guarantee a `swap_settle` for the
   same leg follows in the same transaction, and no other `swap_begin` sits between them. Check the sysvar walk
   handles CPI-nested instructions and versioned transactions.
2. **Delta measurement.** `swap_settle` books `post − pre`. Can a donation to the vault's token account timed
   between begin and settle be counted as swap output, and does that matter (it only increases holders' pot)?
3. **Lamport wrap.** `wrap_fees` moves everything above rent into the WSOL account; `harvest_intake` counts only
   WSOL the top-level `sync_native` made visible. Confirm the vault can never drop below rent-exemption and that
   `pending_swap` reservations are excluded from "new" input.
4. **Bind.** `bind_launch` reads pump.fun's `BondingCurve` by PDA of `expected_mint` and checks `creator == vault`;
   a LaunchLab build must read the pool for (`expected_mint`, `quoteMint`) instead. Confirm the account owner and
   discriminator checks, and that a pool for a different mint cannot be substituted.
5. **Token-2022.** xStocks carry Pausable and Permanent Delegate. A paused stock makes claims for that leg fail —
   verify the failure is clean (no partial state) and retryable. Transfer-hook mints are not allowlisted; confirm
   `allow_basket_mint` rejects unknown extensions if that policy is desired.
6. **Access control.** Two-step admin; operator-only settle/publish; creator-or-admin cancel inside the window
   only; `rescue` only while paused and only for balances outside the accounting.
7. **Arithmetic.** Weight splits (remainder to the last leg), protocol share (bps, capped at 2000), u64 overflow
   paths (`checked_*` everywhere), decimals passed to `transfer_checked`.
8. **Merkle.** Domain separation (`0x00` leaf / `0x01` node), sorted-pair hashing, leaf encoding of `n` and
   amounts, proof length bounds, empty-proof single-leaf trees.

## Custodial keeper (`custodial` mode)

1. **Key derivation.** Vault keypair = `sha256(domain ‖ keeper_secret[0..32] ‖ creator ‖ salt)`. Confirm the
   domain string is unique, the seed uses the secret scalar only, and a vault address cannot be predicted without
   the secret.
2. **Ledger consistency.** Every mutation in `ledger.ts` is a read-modify-write under the keeper lease. Check
   the lease actually serialises the cron keeper and the API entry points (`harvestNow`, `deliverNow`), and what
   happens if a transaction lands but the process dies before the ledger write (each step re-reads chain balances
   on the next run — confirm no double-count).
3. **Bind.** The keeper reads the LaunchLab pool for (`expected_mint`, `quoteMint`) and checks `pool.creator ==
   vault`. Confirm the account owner check and that a pool for a different mint or quote cannot be substituted.
4. **Harvest input.** The intake is idle quote on the vault, forwarded off-chain by StonkFun as a token transfer
   into the vault's quote account: for SOL the wrapped balance is unwrapped first (close + re-open with the vault's
   own rent, so the wallet changes by exactly the wrapped amount), then `input = lamports − floor − Σ pending_swap`;
   for a token quote, the vault's quote token account minus what the
   ledger already accounts for. Confirm a donation to the wallet is treated as fees (acceptable) and that the floor
   keeps the wallet rent-exempt on every cluster. On devnet the keeper also sends LaunchLab's `claimCreatorFee`
   signed by the vault (LINKR's devnet platform keeps an on-chain creator fee); confirm it is never sent on mainnet.
5. **Swap measurement.** Output booked from token-account balances before/after; the Jupiter route (input mint =
   the quote) is signed by the vault, with `wrapAndUnwrapSol` for SOL-quoted vaults. Confirm slippage guard
   (`min_out`) is enforced client-side, that a partially failed transaction cannot leave SOL wrapped and
   unaccounted, and that a leg equal to the quote is booked without a swap.
6. **Deliveries.** `transfer_checked` per leg per leaf, ≤ 4 leaves per holder per transaction, holder token
   accounts created by the keeper. Confirm a leaf cannot be delivered twice (`pushAttemptAt` + `claimed`), and
   what a failed transaction leaves behind (`pushError`, retry after `DIVIDEND_AUTOCLAIM_RETRY_S`).
7. **On-chain commitment.** The memo carries vault, epoch id, root, period and holder count. Confirm the served
   leaves (`/epochs/:id/leaves`) always match the memo, and that the memo is sent before `claimable_at` is set.
8. **Signed actions.** Message `LINKR <action> <target> <ts>`: replay window 5 minutes, action and target bound,
   ed25519 over UTF-8 bytes. Confirm wallets that prefix messages (some hardware wallets) are handled or rejected
   cleanly, and that a signature for one vault cannot act on another.
9. **Policy from env.** `PROTOCOL_SHARE_BPS` capped, `VAULT_PAUSED` honoured by every writer, `BASKET_ALLOWLIST`
   validated against the chain (mint exists, owner program recorded).

## Off-chain computation (both modes)

1. **Balance streams.** Deltas from pre/post token balances aggregated per (transaction, owner); batched RPC
   results re-aligned by signature; `cursorTimestamp` is the head block time read before the walk. Confirm a
   transaction that touches the mint through a nested CPI is captured, and that `getSignaturesForAddress` paging
   cannot skip a signature between runs.
2. **TWAB.** Replay ordering `(slot, index)`, negative-balance guard, excluded owners (vault, LaunchLab's pool
   authority PDA — it owns every curve's token vault — the CPMM authority, `DIVIDEND_EXCLUDED`), snapshot at
   `period_end` used as the next start.
3. **Allocation.** Pro-rata by `acc`, dust dropped, residue kept; `DIVIDEND_DUST_UNITS` per leg.
4. **Epoch timing.** One epoch per run covering every elapsed full period; the projected next close is the next
   boundary after now. Confirm a period cannot be published twice and that a rolled-forward period does not
   double-count its pot.

## Accepted risks (document, do not "fix")

- The keeper chooses harvest timing and slippage; it cannot pay out more than an epoch declared (program mode)
  or without leaving a public mismatch (custodial mode).
- xStocks issuer powers (pause, permanent delegate) apply to every holder of those tokens, LINKR included.
- StonkFun's fee schedule and forwarding are theirs: the platform sets LaunchLab's on-chain creator fee to 0 and
  forwards the creator's 0.5% off-chain, in the quote token; there is no permissionless collect on mainnet. If
  forwarding pauses, dividends pause. Post-graduation (CPMM) creator fees are unconfirmed (`cpmmCreatorFeeOn: 0`) —
  ask StonkFun.
- Custodial mode trusts LINKR between harvest and delivery. This is disclosed in the UI (custodial notice, vault
  page) and is the reason program mode exists.

## Before removing the custodial notice

- Independent review of this checklist's program and custodial sections.
- Legal review of pro-rata stock distributions in the jurisdictions served.
- Mainnet dress rehearsal completed: a real coin, a real Jupiter → xStock swap, a published epoch, a claim.
