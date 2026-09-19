> **Archived.** This is the design and feasibility record of CAUSA's first incarnation, an EVM build with its own
> weighted-pool AMM on an Arbitrum-Orbit L2 launchpad. On 2026-09-10 the product moved to **Solana** (creator-fee
> vaults, xStocks baskets, Jupiter routing) — first on pump.fun, then on **StonkFun (Raydium LaunchLab)** — and the AMM was dropped. Nothing in this file describes
> the current system; it is kept for the reasoning behind decisions that survived the port (time-weighted balances,
> Merkle epochs, "measured, never trusted" accounting). Current docs: `../ARCHITECTURE.md`, `../PRODUCT.md`.

# CAUSA — Design Research & Feasibility Record

> **Historical document.** This is the research deliverable that preceded the build: primary-source
> verification, the Balancer V1/V2/V3 evaluation, the Pons and ERC-8056 findings, and the decision log.
> It is kept because the *reasoning* is still the reference. For the system as built, read
> [`ARCHITECTURE.md`](ARCHITECTURE.md); for the product and brand, [`PRODUCT.md`](PRODUCT.md).
> (Previously `docs/ARCHITECTURE.md`.)

Multi-asset weighted AMM on Robinhood Chain for graduated Pons tokens.

> Status: IMPLEMENTED (2026-09-05). Everything in this report is built and deployed on Robinhood Chain Testnet
> (addresses in `contracts/deployments/46630.json`), including the items originally deferred to v1.1: two-hop
> routing, an indexed `positions` collection and an external ETH/USD reference for the pricing anchor.
> 2026-09-06: added the Pons launch integration ("option A"): `/launch` calls Pons V2 `launchToken`, and
> `ExpansionEscrow` holds a creator-funded plan for the post-graduation multi-asset pool, executed permissionlessly
> (or by the indexer's keeper) once Pons reports graduation. Pons's own curve proceeds cannot be redirected (its
> factory hardcodes a locked Uniswap v4 position). Testnet uses `MockPonsFactory`.
> 2026-09-06 (later): replaced the deposit-funded expansion plan in the wizard with **fee-funded stock dividends**:
> `DividendVaultFactory` / `DividendVault` (see "Stock dividend vaults" below), Uniswap v3 / CAUSA swap
> adapters, a per-token transfer indexer, a TWAB + Merkle dividend keeper (`/api/cron/dividends`) and the
> `/vaults`, `/claims` pages. Protocol share 5% (cap 20%). `ExpansionEscrow` stays deployed but is unlinked.
> Remaining before mainnet: owner confirmation of the six decisions below, an independent audit
> (`docs/AUDIT-CHECKLIST.md`), and hosting on Vercel with a paid RPC. Facts below were verified against primary
> sources or live `eth_call`s on 2026-09-04/05.

## Context

Tokens that graduate from the Pons launchpad on Robinhood Chain get a single 2-token DEX pair. Creators who want liquidity against tokenized equities (NVDA, AAPL, TSLA), USDG, and WETH must deploy fragmented pools. CAUSA lets anyone pair a graduated Pons token with up to 7 other assets in one weighted constant-value pool (e.g. 40/20/20/20) and trade any member asset against any other through it.

This report is the deliverable for the current phase: research findings, feasibility verdicts, and a proposed architecture across contracts, indexer, and frontend. No application code is written until the user approves.

## Verified toolchain (checked 2026-09-04)

| Component | Version | Note |
|---|---|---|
| Next.js | 16.3.4 | App Router, Node runtime (Fluid Compute), no edge runtime |
| wagmi | **2.19.5** (npm `latest` is 3.7.7) | Pinned to v2 because RainbowKit 2.2.11 peer-depends on `wagmi ^2.9.0`; see D.0 |
| viem | 2.56.3 | Chain definitions module `viem/chains` |
| @rainbow-me/rainbowkit | 2.2.11 | Requires wagmi + TanStack Query peer deps |
| mongodb (Node driver) | 7.6.0 | Module-level cached client, low `maxPoolSize` |
| Foundry | 1.x stable | Default `evm_version = prague`; chain runs ArbOS ≥ 40 (verified via `ArbSys.arbOSVersion()`), so `cancun`/`prague` are both safe — we pin `cancun` |
| Node (local) | 22.19.0 | `forge` is NOT installed locally yet — install via `foundryup` in the init step |

Note on the "Wagmi v2" requirement: npm `latest` is wagmi 3.x. RainbowKit 2.2.x peer-depends on wagmi `^2`. Decision below in Pillar D.

## Vercel cron constraint (verified)

| Plan | Min interval | Precision |
|---|---|---|
| Hobby | once per day | ±59 min |
| Pro / Enterprise | once per minute | per-minute |

A once-per-day cron cannot drive a DEX indexer. The sync design therefore has three triggers, any one of which is sufficient (see Pillar C): a Pro-plan minute cron, an on-demand ingest-by-tx-hash endpoint called by the frontend after every confirmed user tx, and an external pinger fallback (GitHub Actions schedule, 5-min minimum) for Hobby.

---

## Pillar A — Smart contract math & multi-token logic

### A.1 Feasibility verdict: YES, with Balancer V3's math ported as-is

The weighted constant-value invariant `V = Π Bᵢ^wᵢ` (Σwᵢ = 1) generalises x·y=k to N tokens. Every operation reduces to one fractional power per call:

| Operation | Formula (18-dec fixed point) | Rounding rule |
|---|---|---|
| Spot price j per i | `(Bᵢ/wᵢ) / (Bⱼ/wⱼ)` | n/a (view) |
| Out given in | `Bₒ · (1 − (Bᵢ / (Bᵢ + aᵢ·(1−fee)))^(wᵢ/wₒ))` | power **up**, result **down** |
| In given out | `Bᵢ · ((Bₒ / (Bₒ − aₒ))^(wₒ/wᵢ) − 1) / (1−fee)` | power **up**, result **up** |
| Proportional join/exit | pure ratio, no `pow` | LP out down, LP in up |
| Unbalanced join | invariant ratio `Π(1 + Δᵢ/Bᵢ)^wᵢ`, fee on the non-proportional part | ratio down |
| Single-token exit | `Bₒ · (1 − (1 − lpIn/S)^(1/wₒ))` with fee on the non-proportional part | out down |

Fractional exponents are computed as `exp(y · ln(x))` in fixed point. This is exactly what Balancer's `LogExpMath` does with **bounded** iteration counts (12-term decomposition + fixed Taylor terms, 20-decimal intermediates, 36-decimal `ln` near 1.0).

### A.2 V1 vs V2 vs V3 evaluation (verified against source)

| | Balancer V1 `BNum/BMath` | Balancer V2 `LogExpMath/FixedPoint/WeightedMath` | Balancer V3 (same libs, moved to `solidity-utils`) |
|---|---|---|---|
| Solidity | `0.5.12` pinned, no checked math | `^0.7.0` | `^0.8.24`, custom errors, `unchecked` blocks |
| `pow` algorithm | binomial series `bpowApprox`, **unbounded loop**, base must be in (0, 2) | `exp(y·ln x)`, fixed iterations | same as V2 |
| Precision | `BPOW_PRECISION = 1e8 wei`, error scales with integer part | `MAX_POW_RELATIVE_ERROR = 1e-14`, `powUp/powDown` add explicit margin | same + `computeInvariantUp/Down` split |
| Weights | denormalized 1–50, min effective 2% | normalized, `_MIN_WEIGHT = 0.01e18` | same |
| Swap caps | in ≤ 50% of balance, out ≤ 33% | in ≤ 30%, out ≤ 30%, invariant ratio ∈ [0.7, 3] | same |
| Token pulls | assumes exact `transferFrom` → **STA exploit (2020)** | vault-side accounting | vault-side, decimal+rate scaling in vault |
| License | GPL-3.0-or-later | `LogExpMath` **MIT**; `FixedPoint`, `WeightedMath` GPL-3.0-or-later | same split |
| Exploit history | fee-on-transfer drain, ~$500k | Nov 2025 ~$120M — **ComposableStablePool `_upscale` rounded down instead of up**; weighted math not implicated | none |

**Decision: vendor Balancer V3's `LogExpMath.sol`, `FixedPoint.sol`, `WeightedMath.sol` (already 0.8.24) into `contracts/src/math/` unchanged, and build our own pool around them.** Reasons:

- Fixed-cost `pow` with no unbounded loop; the V1 series is a gas-griefing and precision hazard near the base bounds.
- Native 0.8 checked arithmetic, custom errors, and the up/down invariant split that post-dates the 2025 exploit analysis.
- Gas on Arbitrum Nitro: L2 execution is priced per-opcode like Ethereum but at a ~0.01–0.02 gwei floor, so a `pow` costing a few thousand gas is economically irrelevant. The **L1 calldata component dominates** the fee. Choosing V3 math over V1 for "safety" costs nothing measurable; the real gas lever is compact calldata (see A.5).
- **Licensing consequence:** the `contracts/` package becomes GPL-3.0-or-later. If the user needs a permissive license, the alternative is Solady's MIT `powWad/expWad/lnWad` with a from-scratch `WeightedMath`: more audit risk. Recommend GPL (standard for open DeFi) and flag for confirmation.

Not chosen: a V3-style shared Vault with transient accounting. It is 10× the surface area and concentrates all pools' custody in one contract. (`TSTORE` itself is available: the chain is past ArbOS 40, so this is a scope decision, not a capability one.)

### A.3 Contract topology — per-pool custody, V3 math, V1-style simplicity

```
contracts/src/
  math/        LogExpMath.sol, FixedPoint.sol, WeightedMath.sol   (vendored, V3)
  WeightedPoolFactory.sol   deploys EIP-1167 clones of WeightedPool; registry; guards; pause
  WeightedPool.sol          ERC20 LP token + reserves + swap/join/exit; one contract per pool
  Router.sol                user entry point: WETH wrap, deadlines, slippage, multi-hop, createAndInit
  PoolQuoter.sol            stateless view lens: quotes + full pool state in one eth_call
  interfaces/               IWeightedPool, IWeightedPoolFactory, IRouter, IERC8056 (Pillar B)
  libraries/                ScalingHelpers (decimals → 18), TokenSort, SafeTransferLib usage
```

**`WeightedPoolFactory`**
- `createPool(tokens[], weights[], swapFeeBps, name, symbol) → pool` (clone + `initialize`); `createAndInitPool(...)` also pulls initial amounts and mints the first LP.
- Guards: 2 ≤ n ≤ 8; tokens unique and ascending; each weight ≥ 1e16 (1%), Σ = 1e18 exactly; decimals ≤ 18; `swapFeeBps ∈ [1, 1000]`; each token passes a **probe** (`balanceOf` before/after a 1-wei self-transfer inside the init pull must equal the amount, else revert `NonStandardToken`); this is the STA lesson enforced at creation time.
- Pons-token slot: `createPool` records `ponsToken` (index 0 by convention). The factory records `ponsVerified` via a try/catch `staticcall` to the Pons V2 factory's `getLaunchedToken` when `PONS_V2_FACTORY` is configured (mainnet only); creation is never blocked by it: a badge, not a gate.
- Registry: `isPool(address)`, `allPoolsLength()`, `allPools(i)`, `getPoolsWithToken(token)`; events `PoolCreated(pool, tokens, weights, swapFee, creator)`.
- Owner controls (multisig): global `pauseSwapsAndJoins()` (exits never pausable), protocol fee share (0–50% of swap fees), fee recipient, and `setImplementation` for **future** pools only (existing pools are immutable).

**`WeightedPool`** (OpenZeppelin `ERC20`, `ERC20Permit`, `ReentrancyGuard`, `Initializable`)
- Storage: `tokens[]`, `normalizedWeights[]`, `scalingFactors[]` (10^(18−decimals)), `reserves[]` (cached raw balances), `swapFee`, `protocolFeesAccrued[]`.
- `initialize(...)`: pulls amounts, computes invariant on upscaled balances, mints `invariant × n` LP; **burns `MINIMUM_LIQUIDITY = 1e6` to `address(0xdead)`** to block the first-depositor inflation attack.
- Swaps: `swapExactIn(tokenIn, tokenOut, amountIn, minOut, to)` and `swapExactOut(..., maxIn, to)`. Pulls from `msg.sender` with **measured-delta accounting** (`balanceAfter − balanceBefore`), applies `MAX_IN_RATIO`/`MAX_OUT_RATIO` = 30%, computes on upscaled balances, downscales output **rounding down**, protocol fee cut taken from the fee portion of `tokenIn` and accrued. Emits `Swap(sender, to, tokenIn, tokenOut, amountIn, amountOut, feeAmount)`.
- Joins: `joinProportional(lpOut, maxAmountsIn)` (exact ratio, no `pow`), `joinExactTokensIn(amountsIn, minLpOut)` (invariant-ratio path, fee on non-proportional part, ratio ≤ 3). Emits `PoolBalanceChanged(provider, deltas[], lpDelta, kind)`.
- Exits: `exitProportional(lpIn, minAmountsOut)`, `exitExactLpForToken(lpIn, tokenOut, minOut)` (ratio ≥ 0.7), `exitExactTokensOut(amountsOut, maxLpIn)`. Never pausable.
- Post-exit floor: every reserve must stay ≥ `MIN_RESERVE = 1e6` raw units, preventing the near-zero-balance precision cliff that amplified the 2020 exploit.
- `sync()` (public): sets `reserves[i] = balanceOf(this)`: absorbs direct donations in favour of LPs (ERC-8056 dividends never change balances, so this is only for stray transfers). `sweep(token)` (factory owner) for tokens that are **not** pool members.
- `collectProtocolFees()`: transfers accrued fees to the factory's fee recipient.
- Views: `getPoolTokens()`, `getNormalizedWeights()`, `getSwapFee()`, `getInvariant()`, `getSpotPrice(i, j)`.

**`Router`** (users approve the Router once per token)
- `swapExactIn(path[], amountIn, minOut, to, deadline)` single- and multi-hop; `swapExactOut`; `payable` variants wrap/unwrap WETH.
- `joinPool`, `exitPool` pass-throughs with `deadline` and min/max checks; `createAndInitPool` for the wizard.
- Approves pools lazily with `type(uint256).max` **only if `factory.isPool(pool)`**, so the Router never approves arbitrary contracts.
- `deadline` compares against `block.timestamp` (see C.1); default UI value 20 min, minimum accepted 5 min.

**`PoolQuoter`**
- Each `WeightedPool` exposes `view` quote functions (`quoteSwapExactIn/Out`, `quoteJoinProportional`, `quoteJoinExactTokensIn`, `quoteExitProportional`, `quoteExitSingle`) that call the **same internal functions** as the mutating paths, so quotes can never diverge from execution. `PoolQuoter` is a thin batching lens over them, used for the on-chain-authoritative `minOut` in the UI.
- `getPoolState(pool)` and `getPoolsState(pools[])` → tokens, weights, reserves, decimals, fee, totalSupply, invariant, spot-price matrix, one `eth_call` for the whole UI.

### A.4 Security rules enforced in code and tests

1. **Rounding always favours the pool**: user pays rounded up, receives rounded down, LP minted down, LP burned up. Upscale/downscale directions follow the same rule (the 2025 bug was an upscale rounded the wrong way).
2. **Round-trip fuzz invariants** (Foundry `invariant_*` + fuzz): A→B→A never profits; join-then-exit never returns more than deposited; invariant is non-decreasing across every swap; spot price after a swap moves monotonically. This is Trail of Bits' post-2025 guidance that "rounding favours protocol" alone is insufficient.
3. **Measured-delta pulls** on every token movement; factory-time non-standard-token probe.
4. **Caps**: 30% in/out per swap, invariant ratio ∈ [0.7, 3] on unbalanced ops, `MIN_RESERVE` floor, `MINIMUM_LIQUIDITY` burn.
5. **Differential tests**: Solidity results vs a TypeScript `bigint` port of the same math (`web/lib/amm-math.ts`) across random inputs; the same TS port drives the UI preview so on-chain and UI never disagree beyond documented error bounds.
6. **Reentrancy**: non-reentrant on all state-changing pool functions; tokens are transferred after state updates (checks-effects-interactions); no callbacks/hooks in v1.
7. **No `block.number`, `blockhash`, or `prevrandao` anywhere** (Arbitrum returns L1 estimates / constants).

### A.5 Gas notes specific to Arbitrum Nitro

- L1 data fee = Brotli-compressed calldata × 16 → converted into L2 gas units; shows up in `eth_estimateGas` and receipt `gasUsedForL1`. Zero-runs compress well, so `uint256[]` with small values is cheap, but high-entropy words (addresses, 1e18 amounts) are not.
- Deploy pools as EIP-1167 clones: ~45 bytes of init code per pool instead of ~20 KB of bytecode posted to L1. The extra `DELEGATECALL` per call (~2.6k L2 gas) is negligible at L2 prices.
- Use `PoolQuoter` batched reads and viem multicall so the UI issues few RPC calls (RPC rate limits, not gas, are the binding constraint).

### A.6 Foundry configuration

```toml
[profile.default]
solc = "0.8.28"            # pin; libs are ^0.8.24
evm_version = "cancun"     # chain verified at ArbOS ≥ 40, so cancun (PUSH0/TSTORE/MCOPY) is safe; matches Offchain Labs' and Pons' own configs. "prague" also works but adds nothing we use
optimizer = true
optimizer_runs = 10_000    # pools are called far more than deployed
via_ir = false
fs_permissions = [{ access = "read", path = "./" }]

[rpc_endpoints]
robinhood = "${ROBINHOOD_RPC_URL}"
robinhood_testnet = "${ROBINHOOD_TESTNET_RPC_URL}"
```

`ArbSys.arbOSVersion()` returned 116 on both networks (Nitro encodes 55 + ArbOS version), i.e. far past ArbOS 40, so the Cancun opcode set is confirmed without a deployment probe. Verification is Blockscout (`forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/`), not Arbiscan.

---

## Pillar B — Robinhood stock tokens (ERC-8056)

### B.1 What ERC-8056 actually is (verified against the EIP and live contracts)

ERC-8056 "Scaled UI Amount Extension for ERC-20 Tokens" (Draft, created 2025-10-20, authors from Superstate, Robinhood, and Coinbase) adds a **display-only multiplier** to a normal ERC-20:

| Interface | ERC-165 ID | Members | NVDA on mainnet |
|---|---|---|---|
| `IScaledUIAmount` (core) | `0xa60bf13d` | `uiMultiplier()` (1e18 = 1.0); events `UIMultiplierUpdated(old, new, effectiveAt)`, `TransferWithUIAmount`, `UIMultiplierUpdateCancelled` | supported |
| `IScaledUIAmountNewUIMultiplier` | `0x4bd27648` | `newUIMultiplier()`, `effectiveAt()` (scheduled update) | supported |
| `IScaledUIAmountBalances` | `0xd890fd71` | `balanceOfUI(addr)`, `totalSupplyUI()` | supported |
| `IScaledUIAmountConversion` | `0x57854fc3` | `toUIAmount()`, `fromUIAmount()` | not implemented |

**Normative rule from the spec:** `balanceOf`, `transfer`, `transferFrom`, `approve`, `allowance`, `totalSupply` all operate on **raw units and MUST NOT change** when the multiplier changes. `shares = raw × uiMultiplier / 1e18`.

Live values read via `eth_call` on 2026-09-04:

| Token | `uiMultiplier()` | `decimals()` | `paused()` |
|---|---|---|---|
| NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `1.0e18` | 18 | false (function exists) |
| CRWD `0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931` | **`4.0e18`** | 18 | — |
| USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | n/a | **6** | — |
| WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | n/a | 18 | — |

Corporate actions on Robinhood Chain: **stock splits** change only the multiplier (CRWD's 4.0 is a live example). **Cash dividends are reinvested** by nudging the multiplier upward (no airdrop, no rebase). Large updates are scheduled via `newUIMultiplier()`/`effectiveAt()` with a **pause window** during which `transfer` reverts (`onlyNotPaused`). Tokens transfer 24/7; the Chainlink reference feed is 24/5 and exposes `oraclePaused()`.

### B.2 AMM accounting strategy: raw units, no wrapper, one optional guard

**Core insight: an ERC-8056 token is not a rebasing token.** Balances never move without a `Transfer`, so the pool's cached reserves and the invariant are untouched by splits and dividends. Economic check: before a 4:1 split one raw unit = 1 share × $P; after, one raw unit = 4 shares × $P/4 = $P. **The value of a raw unit is split-neutral**, so the pool needs no repricing. Dividend reinvestment raises a raw unit's value by the dividend yield (a few % per year), which arbitrageurs capture from LPs exactly as with wstETH in any AMM — small and accepted.

Therefore:
1. **Pool math uses raw balances exclusively.** Weights, reserves, invariant, LP supply, all raw. No rate provider, no wrapper, no `uiMultiplier()` call in the swap path.
2. **Decimal scaling is separate from the multiplier**: `scalingFactor = 10^(18 − decimals)` handles USDG's 6 decimals; ERC-8056 does not alter `decimals()`.
3. **Tolerate `transfer` reverting.** During a corporate-action pause a swap or proportional exit touching that token simply reverts (no state change). `exitExactLpForToken` on a non-paused member remains available so LPs are never fully locked.
4. **Optional corporate-action guard (recommended, ~40 lines):** at pool creation the factory records `isScaledUi[i] = supportsInterface(0xa60bf13d)`. For swaps involving such a token the pool does one `staticcall` to `newUIMultiplier()`/`effectiveAt()` and reverts `CorporateActionPending` if `newUIMultiplier != uiMultiplier && |effectiveAt − block.timestamp| < 1 hour`. This protects LPs from the window where the equity's market price and the on-chain multiplier may briefly disagree. Off-hours staleness (weekends) is an accepted LP risk in v1, identical to the existing Uniswap pools on this chain; a time-of-week fee schedule is a v1.1 candidate.
5. **Ticker-squatting defence:** the curated `tokens` list is seeded from Robinhood's registry (`https://api.robinhood.com/rhj/assets`, returns `contractAddress`, `tokenSymbol`, `currentMultiplier` for ~125 assets) rather than symbol lookups; unknown addresses get an "unverified" badge in the wizard.

### B.3 Frontend and indexer handling

- `tokens` docs carry `erc8056: { uiMultiplier, newUIMultiplier, effectiveAt, paused, syncedAt }`, refreshed each cron run by one multicall across all ERC-8056 tokens and by `UIMultiplierUpdated` events.
- **Display unit is shares** for stock tokens: `shares = raw × uiMultiplier / 1e18`, with a "raw units" toggle. Inputs typed in shares are converted to raw with floor rounding client-side (the conversion extension is not on-chain). Spot prices display per share: `pricePerShare = pricePerRaw × 1e18 / uiMultiplier`.
- USD pricing per raw unit in the price graph (C.4) is multiplier-agnostic; only the UI divides by the multiplier.
- Banner states: "Corporate action scheduled at <effectiveAt>" when `newUIMultiplier ≠ uiMultiplier`; "Transfers paused" when `paused()`; swap button disabled in both.
- Indexer volume/TVL never applies the multiplier (raw `Transfer`/`Swap` amounts × per-raw price). The spec's `TransferWithUIAmount` event is optional and is ignored.

---

## Pons launchpad integration (verified)

**Domain correction:** `pons.family` does not resolve. The product is **ponsfamily.com**, docs at docs.ponsfamily.com (root page documents legacy V1; `/v2` documents the current model), source at github.com/ponsdotdev/ponsfamily. Not an official Robinhood product.

| | Pons V1 (legacy) | **Pons V2 (current, Aug 2026)** |
|---|---|---|
| Launch model | fixed supply into a locked one-sided Uniswap v3 position, no curve | constant-product bonding curve → permanently locked full-range **Uniswap v4** pool with `PonsV2MemeHook` (pool fee 0, hook charges fees) |
| "Graduation" | 4.2 ETH locked principal; trading continues in same v3 pool | curve sells out → `CurveCompleted` → v4 pool seeded; `createGraduatedPool(token)` is permissionless if auto-seed fails |
| Token contract | ERC-20 with **temporary** max-wallet / max-tx / launch-block restrictions in `_update`, triggered only on buys from registered v3 pools, expiring at `restrictionEndBlock` | `ERC20 + ERC20Burnable`, **no overrides, no tax, no blacklist**: AMM-safe |
| Provenance check | `graduationStatus(token) → (current, threshold, graduated)` on V1 factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` | `getLaunchedToken(token)` on V2 factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` → `exists == true && phase == 2` |
| On testnet 46630 | not deployed | **not deployed** (verified: 0 bytes of code at the factory address). Uniswap v4 PoolManager *is* on testnet at the mainnet address. |

Code presence verified on mainnet via `eth_getCode`: V2 factory (24,177 B), V2 hook, V2 launch router, V1 factory.

**Design consequences**
- Wizard step 1 performs a **soft** graduation check server-side (`GET /api/tokens/verify`): on mainnet call `getLaunchedToken` (V2) then `graduationStatus` (V1); on testnet, or if `PONS_V2_FACTORY` is unset, return `unverified`. The factory contract additionally records `ponsVerified` at creation through a try/catch `staticcall` so the badge is on-chain, but **creation is never blocked**: a hard gate would make testnet unusable and couples us to a third party's upgrade cycle.
- Reference price for a graduated token (wizard step 4 sanity check) comes from GeckoTerminal's public API (`robinhood` network slug) in v1; v1.1 can quote the v4 pool directly with the Pons `PoolKey` (hook address `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`, fee 0).
- V1 tokens are accepted but flagged; their restrictions do not apply to transfers into our pool (they trigger only on registered v3 pool buys) and expire anyway.
- Avoid the Medium "Pons API" article's addresses; they are wrong. Bitquery/Mobula are third-party indexers, not first-party APIs.

---

## Stock dividend vaults (fee-funded, verified 2026-09-06)

**What Pons actually does with fees** (docs.ponsfamily.com/v2 + `contractsV2/src/v2`): holders receive nothing. Of
every trade the protocol takes its share, an optional buyback slice follows, and the remainder plus 100% of the
creator tax (≤ `maxCreatorTaxBps` = 1000) goes to the creator, always in the launch's **pair asset** (native ETH when
`pairToken == 0`, else USDG/NVDA/TSLA/AAPL on mainnet). Fees accrue on the curve / the v4 hook until a sweep credits
`feeEscrow()` (`0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e`), whose `claim()`/`claimToken(token)` pay **msg.sender**.
`creatorFeeRecipient` is fixed at `launchToken` (0 = caller) and movable by the current recipient; `getLaunchedToken`
exposes it together with `deployer`. Post-graduation `sweepPoolFees` on the hook is callable by Pons's operator or the
current creator fee recipient.

**Design.** One `DividendVault` clone per launch is the launch's fee recipient:

| Piece | Role |
|---|---|
| `DividendVaultFactory` (Ownable2Step) | clones vaults, `bindLaunch(vault, token)` (permissionless; requires `creatorFeeRecipient == vault && deployer == vault.creator`, bind-once), config: `operator` (keeper), `swapAdapter`, `protocolShareBps` (≤ 2000), `protocolRecipient`, `disputeWindow` (< `minEpochLength`), `claimWindow`, basket allowlist, pause |
| `DividendVault` | `harvest(minOuts)` (operator/creator): fold stray basket balances → claim from the escrow (wrap ETH) → measured input → protocol cut → weight split (remainder to the last leg, no swap when the leg *is* the asset) → adapter swaps with vault-side delta ≥ `minOut` → `unallocated`. `publishEpoch(root, tokens, amounts, periodStart, periodEnd, holders)` (operator; `periodStart == lastPeriodEnd`, length ≥ `epochLength`, `unallocated -= amounts`, `claimableAt = now + disputeWindow`). `cancelEpoch` (creator/owner, latest only, before `claimableAt`), `expireEpoch` (anyone after `claimableAt + claimWindow`), `claim`/`claimMany` (OZ `MerkleProof`, leaf `keccak256(bytes.concat(keccak256(abi.encode(epochId, account, amounts))))`, per-token `claimedTotals ≤ amounts`, paused stocks go to `pending` + `withdrawPending`), `sweepPonsPoolFees` pass-through, `rescue` for non-basket tokens |
| `UniswapV3SwapAdapter` / `StockBoundSwapAdapter` | owner-registered v3 paths (`SetRoutes.s.sol`) / pinned or auto-picked CAUSA pool; both pull from the vault and deliver to it |
| `MockFeeEscrow` (testnet) | Pons escrow ABI with permissionless `credit`/`creditToken` |

Invariant per token: `balanceOf ≥ unallocated + allocated + pendingTotal`, `allocated == Σ open epochs (amounts − claimedTotals)`,
period chain continuous across non-cancelled epochs (fuzz + invariant + FFI tests: `test/Dividend*.t.sol`, `test/invariant/DividendInvariant.t.sol`,
`test/DividendMerkle.ffi.t.sol` against `web/lib/dividends/merkle.ts`).

**Indexer.** Factory + vault events join the main log stream (second pass for vaults created inside a chunk). Bound launch
tokens get their own `transfer_streams` (own cursor / chunking / reorg rewind, backfilled from `launchedAtBlock`).
**TWAB** (`web/lib/dividends/twab.ts`, pure bigint): half-open period `[S, E)`, transfers with `t ≤ S` form the starting
balance (previous `holder_snapshots` at `periodEnd == S` or a full replay), `S < t < E` are replayed with lazy per-account
accrual, excluded addresses (vault, factory, adapter, escrows, router, Pons factory/curve/PoolManager/buyback vault/hook, every
CAUSA pool, 0x0, dead, `DIVIDEND_EXCLUDED`) keep balances but earn no weight. Allocation floors per holder, drops shares
below 1e-6, residue rolls forward; leaves + proofs are stored in `epoch_leaves` and served for audit.
**Keeper** (`/api/cron/dividends`, Mongo lease, budget 240 s): bind → streams → harvest when `escrowClaimable + idleAsset ≥ DIVIDEND_MIN_HARVEST`
(quotes: QuoterV2 via `simulateContract` on mainnet, `PoolQuoter` elsewhere) → epoch close when a full period has elapsed and the
stream cursor passed `periodEnd` (one epoch covers every elapsed full period) → expire.

**Delivery.** `claimMany` settles all requested epochs first and transfers each token once (`_settle`/`_deliver`), so
accumulated payouts cost one transfer per stock. Creators may opt in to keeper-paid delivery (`setAutoClaim`, event
`AutoClaimUpdated`): the keeper claims for holders `DIVIDEND_AUTOCLAIM_DELAY_S` after `claimableAt`, retries every
`DIVIDEND_AUTOCLAIM_RETRY_S`, skips shares below `DIVIDEND_AUTOCLAIM_MIN_USD`, caps holders per run, and retries
`withdrawPendingFor` for stocks that were paused at claim time (`pending_deliveries`, fed by `PendingCredited`/
`PendingWithdrawn`). Gas per delivered holder is ~150–200k; the report tracks `gasEth`.

**Trust boundary.** The operator only chooses harvest timing/slippage and publishes roots; funds can only move into basket
tokens inside the vault or to claimants. Review window + cancel, the per-token overclaim cap, and public per-holder data are the
defences. No on-chain TWAP guard in v1 (v1.1 candidate). Paying tokenized stock pro rata to holders resembles a dividend:
get legal advice before mainnet.

## Pillar C — L2 constraints, indexer, MongoDB schema

### C.0 Verified chain facts

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 (`eth_chainId` → `0x1237`, confirmed) | 46630, confirmed |
| Public RPC (rate-limited, "not for production") | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Recommended RPC | Alchemy `robinhood-mainnet.g.alchemy.com/v2/{key}`; QuickNode, dRPC, Blockdaemon also listed | Alchemy |
| Explorer | Blockscout `robinhoodchain.blockscout.com` | `explorer.testnet.chain.robinhood.com` |
| viem export | `robinhood` (`blockTime: 100`, multicall3 at `0xca11bde0…`) | `robinhoodTestnet` |
| Stack | Arbitrum Nitro Orbit **L2 settling to Ethereum**, blob DA (rollup mode), ETH gas, FCFS sequencer, no priority-fee auction | same |
| ArbOS | `arbOSVersion()` → 116 (= 55 + ArbOS) on both → **≥ ArbOS 40**: PUSH0, TSTORE/TLOAD, MCOPY, Pectra all available | same |
| Block height on 2026-09-05 | ~54.5 M | ~113 M |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | `0x7943e237c7F95DA44E0301572D358911207852Fa` (verified: code + `symbol() == "WETH"`) |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals | not published |
| Stock tokens | ~125 in registry API; testnet faucet dispenses TSLA, AMZN, PLTR, NFLX, AMD | addresses discovered from faucet txs |
| Permit2 / Multicall3 | canonical addresses, present | present |
| Faucet | — | `https://faucet.testnet.chain.robinhood.com/` (ETH + stock tokens) |
| Other DEXs | Uniswap v2/v3/v4 + UniswapX, PancakeSwap, Balancer v2 all deployed | Uniswap v4 present |

### C.1 Arbitrum Nitro semantics that matter

- **`block.number` ≈ Ethereum L1 block number**, refreshed every ~13–15 s (Robinhood's own docs confirm). It is useless for L2 timing, TWAP windows, or log pagination. The L2 height is `ArbSys(0x64).arbBlockNumber()` on-chain and `eth_blockNumber` / log `blockNumber` off-chain.
- **`block.timestamp` is the sequencer clock**: monotonic non-decreasing (consecutive blocks often share a second), allowed to drift 24 h behind / 1 h ahead of wall-clock. Arbitrum's guidance: reliable over hours, unreliable over minutes. Consequences: swap deadlines use `block.timestamp` with a UI default of 20 min and a contract-enforced minimum of 5 min; no on-chain TWAP in v1 (if added later: timestamp-weighted with a `Δt == 0` guard).
- **~100 ms blocks** (viem hardcodes `blockTime: 100`; QuickNode calls them "sub-second and irregular") → ~864 k blocks/day. A 10,000-block `eth_getLogs` window is ~17 minutes of history. Cursor pagination must be in L2 blocks and chunk sizes tuned accordingly.
- `blockhash`, `prevrandao` (constant 1), `block.coinbase` are non-standard — none are used.
- Gas: L2 execution at a ~0.01–0.02 gwei floor plus an L1 data fee (Brotli-compressed calldata × 16, folded into gas units; `eth_estimateGas` includes it, receipts expose `gasUsedForL1`). Set `maxPriorityFeePerGas = 0` client-side; tips buy nothing.
- **`eth_getLogs`**: Nitro imposes no protocol limit; providers do. Alchemy on Arbitrum-family chains has been reported at 10 blocks/request on the free tier (unlimited on PAYG) with a 10,000-result cap; QuickNode recommends ≤ 10,000 blocks; Robinhood publishes no numbers for its public endpoint. Hence the adaptive chunking in C.2 and a paid indexer endpoint (Alchemy PAYG or QuickNode) as the default `INDEXER_RPC_URL`, with Blockscout's API as a secondary log source.
- Sequencer feed is public (Chainstack publishes a decoder), so sandwich-style front-running is possible even without a mempool: slippage limits are mandatory, not cosmetic.

### C.2 Sync worker strategy

**Principle: every write is an idempotent upsert keyed by on-chain identity.** Re-running any range is always safe.

Three ingestion paths write through one shared `ingestLogs(logs[])` function:

1. **Range sync (cron)**: `GET /api/cron/sync` (protected by `CRON_SECRET` bearer header). Reads `sync_state` cursor, fetches logs from `cursor+1` to `head - CONFIRMATIONS` in adaptive chunks, ingests, advances cursor. Budget-limited: stops after N chunks or ~40s to stay under function duration, next run continues.
2. **Tx ingest (on-demand)**: `POST /api/sync/tx { txHash }`. Frontend calls it after `useWaitForTransactionReceipt` resolves. Server fetches the receipt via RPC, filters logs to known contracts, ingests. This is what makes the UI reflect a user's own swap immediately regardless of cron cadence. Rate-limited per IP; validates the receipt is from a CAUSA contract.
3. **Backfill / repair (admin)**: `POST /api/admin/resync { fromBlock, toBlock }` with admin secret. Re-ingests a range; idempotency makes this safe.

**Adaptive getLogs chunking:** the cursor starts at the factory's deployment block (never genesis); start at 2,000 blocks/request (~3 min of chain history at 100 ms blocks); on RPC error (range too large / too many results / 429) halve and retry with backoff; after 3 consecutive successes double, capped at 10,000. One request per contract address set (factory + all known pools via `address[]` param), all topics, then dispatch by topic. Store `lastChunkSize` in `sync_state` so the worker "remembers" what the RPC tolerated.

**Reorg handling:** Arbitrum sequencer reorgs are rare but possible before L1 batch posting. Index only up to `head - 20` blocks (~2 s at 100 ms blocks, negligible UX cost). Store `blockHash` on every event doc; the cron re-checks the hash of the cursor block each run and, on mismatch, rewinds the cursor 200 blocks and deletes events with `blockNumber > rewindPoint` before re-ingesting.

**Derived state (reserves/TVL/volume)** is computed in the indexer, not read from chain per request:
- Reserves: pool `balances` updated from each `Swap`/`PoolBalanceChanged` event's deltas, then **reconciled** against an on-chain `getPoolTokens()` read every K cron runs (catches donations, `sync()` calls, and rounding drift).
- Volume: per-swap USD value using the price model in C.4, accumulated into hourly buckets.
- TVL: Σ reserves × price at snapshot time.

### C.3 MongoDB collections & indexes

All amounts stored as **decimal strings of raw wei** (never JS numbers) plus a `Decimal128` USD field where relevant. `_id` values are deterministic so upserts are natural.

**`sync_state`**, one doc per indexed stream
```
_id: "logs:mainnet"            // or "logs:testnet"
chainId, cursorBlock, cursorBlockHash, lastChunkSize, lastRunAt, lastError, headAtLastRun
```

**`tokens`**: every token that appears in any pool
```
_id: "<chainId>:<addressLower>"
address, chainId, symbol, name, decimals,
kind: "pons" | "stock" | "stable" | "weth" | "other",
erc8056: { uiMultiplier: string, newUIMultiplier: string, effectiveAt: number, paused: bool, syncedAt } | null,
priceUsd: Decimal128 | null, priceSource: "anchor" | "pool" | "none", priceUpdatedAt,
logoUrl, isVerified
index: { chainId, symbol }
```

**`pools`**
```
_id: "<chainId>:<poolAddressLower>"
address, chainId, factory, createdAtBlock, createdAtTx, createdAt, creator,
tokens: [{ address, weight: string(1e18), reserve: string(raw), reserveUsd: Decimal128 }],
swapFeeBps, lpTotalSupply: string,
tvlUsd: Decimal128, volume24hUsd, volume7dUsd, fees24hUsd, swapCount,
ponsToken: address | null, name, symbol,
lastEventBlock, lastReconciledBlock
indexes: { chainId, tvlUsd: -1 }, { chainId, "tokens.address" }, { chainId, ponsToken }
```

**`swaps`**
```
_id: "<chainId>:<txHash>:<logIndex>"
chainId, pool, txHash, logIndex, blockNumber, blockHash, timestamp,
sender, recipient, tokenIn, tokenOut, amountIn: string, amountOut: string,
amountInUsd: Decimal128, feeUsd: Decimal128
unique index on _id (implicit); { pool, timestamp: -1 }; { sender, timestamp: -1 }; { chainId, timestamp: -1 }
```

**`liquidity_events`**
```
_id: "<chainId>:<txHash>:<logIndex>"
chainId, pool, kind: "join" | "exit" | "init", provider, deltas: [string], lpDelta: string,
blockNumber, blockHash, timestamp, valueUsd
indexes: { pool, timestamp: -1 }, { provider, timestamp: -1 }
```

**`pool_snapshots`**: hourly rollups for charts (bucket pattern)
```
_id: "<chainId>:<pool>:<hourStartUnix>"
pool, chainId, hourStart, tvlUsd, volumeUsd, feesUsd, swapCount,
reserves: [string], lpTotalSupply: string, spotPrices: { "<tokenA>-<tokenB>": Decimal128 }
index: { pool, hourStart: -1 }
TTL: none (retain); daily rollup collection optional later.
```

**`positions`** (optional v1.1) — LP `Transfer` events aggregated per holder for the "my liquidity" dashboard without RPC fan-out. v1 reads LP balances on-chain for the connected wallet only (one `useReadContracts` multicall).

### C.4 Pricing model (for TVL/volume in USD)

Anchor: USDG = $1.00. Every other token price is derived from indexed pool spot prices along the shortest path to USDG (or WETH if WETH has a USDG path), weighted by pool TVL when multiple paths exist. Tokens with no path are `priceSource: "none"` and their reserves are excluded from TVL (pool marked "partially priced" in UI). Optional later: external ETH/USD and equity reference prices for sanity-bounding.

Spot price of token j in terms of token i in a weighted pool: `(B_i / w_i) / (B_j / w_j)`, computed from reserves with raw units scaled by decimals.

### C.5 RPC access strategy

- Server-side only: env `ROBINHOOD_RPC_URL` (mainnet) / `ROBINHOOD_TESTNET_RPC_URL`; `INDEXER_RPC_URL` on a paid Alchemy or QuickNode endpoint (both verified to support chain 4663) for the indexer; public RPC only as a last-resort fallback for wallets.
- Frontend reads go through `/api/*` → MongoDB. The only direct-RPC calls from the browser are: wallet-connected balances/allowances (`useReadContracts` multicall), tx simulation (`useSimulateContract`), and one `PoolQuoter.quote()` call for the exact swap quote.
- viem `multicall` batching enabled in the wagmi transport (`batch: { multicall: true }`) so wallet reads collapse into one `eth_call`.

---

## Pillar D — Frontend user flows

### D.0 Stack decision inside the "Wagmi v2" requirement

Verified: `@rainbow-me/rainbowkit@2.2.11` peer-depends on `wagmi ^2.9.0` and `viem 2.x`; it does not accept wagmi 3. So the pinned set is **wagmi 2.19.5 + viem 2.56.x + RainbowKit 2.2.11 + @tanstack/react-query 5.x**, which is exactly the user's stated stack. Do not upgrade to wagmi 3 until RainbowKit publishes a compatible major.

Chain config: `import { robinhood, robinhoodTestnet } from 'viem/chains'` (verified export names; not `robinhoodChain`). Both definitions point at the rate-limited public RPC and carry no WebSocket URL, so the wagmi config overrides transports: `http(process.env.NEXT_PUBLIC_RPC_URL, { batch: true })` with `batch: { multicall: true }` on the client. Active chain chosen by `NEXT_PUBLIC_CHAIN_ID` (46630 during development).

Provider tree (`app/providers.tsx`, client component): `WagmiProvider` → `QueryClientProvider` → `RainbowKitProvider`. SSR-safe with cookie-persisted wagmi state (`cookieToInitialState` in the root layout).

### D.1 Create Pool Wizard (`/create`)

Steps and the exact hooks/queries behind each:

1. **Pons token**: address input. `useReadContracts` on `[name, symbol, decimals, totalSupply]`; server check `GET /api/tokens/verify?address=` (Pons V2 `getLaunchedToken` → `exists && phase == 2`, V1 `graduationStatus` fallback, `unverified` on testnet (see Pons section). Reject fee-on-transfer/rebasing tokens via a server-side probe (see Pillar A guard).
2. **Assets**: picker fed by `GET /api/tokens?kind=stock|stable|weth` (curated list in `tokens`). Max 7 additional assets (8 total). Duplicate/Pons-token exclusion.
3. **Weights**: slider per token, integer percent, must sum to 100, each ≥ 1%. Client converts to `uint256` weights in 1e18 with the remainder assigned to the Pons token so Σ = exactly 1e18.
4. **Initial liquidity**: amount inputs per token; live "implied initial price" table computed locally (`spotPrice` formula) so the creator sees e.g. "1 PONS = 0.0021 NVDA". Warn when implied price deviates from the Pons DEX price (fetched via `GET /api/tokens/:address/reference-price`). Wallet balance check via `useReadContracts`.
5. **Approvals**: for each token: `allowance(owner, ROUTER)` multicall → `approve` per token needing it (`useWriteContract`, sequential, with `useWaitForTransactionReceipt`).
6. **Deploy**, one tx: `Router.createAndInitPool(tokens, weights, amounts, swapFeeBps, name, symbol)` → `useSimulateContract` then `useWriteContract`. On receipt: `POST /api/sync/tx` with the hash, then `router.push('/pool/<address>')` (address parsed from the `PoolCreated` log via viem `parseEventLogs`).

Components: `CreatePoolWizard` (stepper state machine), `TokenAddressInput`, `AssetPicker`, `WeightEditor`, `InitialLiquidityForm`, `ApprovalQueue`, `TxStatus`.

### D.2 Swap (`/swap`)

- Token lists from `GET /api/tokens?inPools=true`. On pair selection: `GET /api/route?tokenIn&tokenOut` returns candidate pools (v1: single-hop, choose max-liquidity pool; v1.1: 2-hop via Pons token or USDG).
- **Local quote** (instant, per keystroke): TS port of the weighted math (`lib/amm-math.ts`) with `bigint`: `calcOutGivenIn`, `calcInGivenOut`, `spotPrice`. Uses the pool reserves from the API (≤ 1 min stale). Displays: spot price, effective price, **price impact** = `1 − spotBefore/effective`, fee amount, minimum received at the user's slippage tolerance.
- **Exact quote** (debounced 300 ms): one `PoolQuoter.quoteSwapExactIn` `eth_call` via `useReadContract`, used for `minAmountOut` in the tx. Local number is only a preview; on-chain quote is authoritative.
- Submit: `Router.swapExactIn(pool, tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline)`; `deadline = now + 20 min` (timestamp, see C.1). ETH input auto-wraps via router `payable` path.
- Post-tx: `POST /api/sync/tx`, invalidate TanStack queries for pool + balances.
- ERC-8056 display: amounts shown as `raw × uiMultiplier` shares with a "raw units" toggle (see Pillar B).

Components: `SwapCard`, `TokenSelect`, `AmountInput`, `QuoteDetails`, `SlippageSettings`, `SwapButton` (state machine: connect → approve → swap), `PriceImpactWarning` (>2% amber, >5% red confirm).

### D.3 Liquidity dashboard (`/pools`, `/pool/[address]`, `/portfolio`)

- `/pools`: `GET /api/pools?sort=tvl&chainId=` table — tokens (weights as a stacked bar), TVL, 24h volume, fees, APR estimate (fees24h × 365 / TVL).
- `/pool/[address]`: `GET /api/pools/:address` (composition, reserves, spot-price matrix) + `GET /api/pools/:address/snapshots?range=7d` for TVL/volume charts + `GET /api/pools/:address/swaps` recent activity. Connected wallet: `useReadContracts` for LP balance + `totalSupply` → share % and underlying claim.
- **Deposit** tab: proportional join (enter one token, others auto-filled by ratio, zero price impact) or single/unbalanced join (shows price impact from invariant-ratio math). `PoolQuoter.quoteJoinProportional` / `quoteJoinExactTokensIn` for exact `minLpOut`. Approvals as in D.1.
- **Withdraw** tab: proportional exit (percent slider) or single-token exit with impact. `PoolQuoter.quoteExitProportional` / `quoteExitSingle` for `minAmountsOut`.
- `/portfolio`: positions via on-chain LP balances across pools the wallet has joined (from `liquidity_events` by `provider`), plus history table.

Components: `PoolTable`, `PoolHeader`, `CompositionBar`, `ReserveTable`, `TvlVolumeChart`, `JoinForm`, `ExitForm`, `PositionCard`, `ActivityTable`.

---

## Repository layout (proposed)

```
causa-rh/
  contracts/            Foundry project (forge, src/, test/, script/)
  web/                  Next.js 16 app (app/, lib/, components/, indexer/)
  packages/abi/         generated ABIs + typed addresses per chainId (shared)
  README.md
```

## Implementation phases (after approval)

1. **Repo init**: `forge init` under `contracts/`, `create-next-app` under `web/`, shared `packages/abi`, env templates, chain config for 46630 first. Install Foundry via `foundryup` (not present locally).
2. **Contracts**: vendor V3 math → `WeightedPool` → `WeightedPoolFactory` → `Router` → `PoolQuoter`; unit, fuzz, invariant, differential tests; deploy + Blockscout-verify on testnet; seed two pools with faucet stock tokens.
3. **Indexer + API**: MongoDB collections/indexes, `ingestLogs`, cron range sync, tx ingest, reconciliation, pricing, REST routes.
4. **Frontend**: providers, pools list, pool page, swap, create wizard, liquidity, portfolio.
5. **Hardening**: gas snapshots, e2e on testnet, audit checklist, mainnet address config, deploy scripts with multisig owner.

## Verification (end-to-end)

- **Math**: `forge test` with `forge fuzz` runs ≥ 10k per property; `invariant_*` suites (invariant non-decreasing, no round-trip profit, LP conservation); differential test harness feeding random inputs through both Solidity and `web/lib/amm-math.ts` (via `vm.ffi` to a Node script) asserting equality within documented error bounds; `forge snapshot` for gas.
- **Chain**: `anvil --fork-url $ROBINHOOD_TESTNET_RPC_URL` for local runs against real faucet tokens; `forge script Deploy --rpc-url robinhood_testnet --broadcast --verify --verifier blockscout`; `cast call` NVDA/CRWD `uiMultiplier()` from tests to confirm the ERC-8056 guard path.
- **Indexer**: run `/api/cron/sync` against testnet with a local MongoDB; assert idempotency by re-running the same range and diffing collections; force a rewind and confirm re-ingestion; compare indexed reserves to `getPoolTokens()`.
- **Frontend**: wallet connect on 46630, create a 4-token pool (Pons-style test token + TSLA + AMZN + WETH) with faucet funds, swap TSLA→AMZN through it, join, exit; confirm the pool page reflects the swap within seconds via tx-ingest and within a minute via cron.

## Decisions needed from the user (defaults assumed if unstated)

1. **Vercel plan**: assumed **Pro** (minute cron). On Hobby, the fallback is a GitHub Actions schedule (5-min minimum) hitting the sync endpoint; tx-ingest keeps the UI live either way.
2. **License**: assumed **GPL-3.0-or-later** for `contracts/` (forced by Balancer's `WeightedMath`/`FixedPoint`). Permissive alternative costs a from-scratch math rewrite on Solady.
3. **Pons gate**: assumed **soft badge**, not a hard revert, so testnet works and any ERC-20 can be pooled.
4. **Protocol fee**: assumed 10% of swap fees to a treasury, owner-adjustable up to 50%.
5. **Corporate-action guard**: assumed **included** (B.2 item 4).
6. **Testnet first**: all deployment and QA on 46630; mainnet only after an explicit go.

## Open items (could not be verified)

- Whether stock-token `paused()` gates `transfer` specifically (Beosin analysis says yes; source is not verified on Blockscout). Design already tolerates it either way.
- Robinhood public RPC numeric rate limits and `eth_getLogs` range caps — undocumented; adaptive chunking handles any value.
- Testnet stock-token addresses — obtained at implementation time from faucet transactions.
- Exact ArbOS release corresponding to the raw value 116 — irrelevant beyond "≥ 40".
- Chainlink tokenized-equity feed proxy addresses on Robinhood Chain — only needed if external price sanity checks are added later.
