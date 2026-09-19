<div align="center">

# LINKR — Product & Brand Book

**Every market starts with a reason.**

<sub>Engineering: <a href="ARCHITECTURE.md">ARCHITECTURE.md</a> · Audit scope: <a href="AUDIT-CHECKLIST.md">AUDIT-CHECKLIST.md</a> · Go-live: <a href="DEPLOY.md">DEPLOY.md</a></sub>

</div>

---

## 0. TL;DR

LINKR turns a live catalyst into a **StonkFun coin whose holders are paid in tokenised stocks**.

- A creator launches a coin on StonkFun (stonkfun.xyz, on Raydium LaunchLab) through LINKR, quoted in any of
  StonkFun's pairs (SOL, an xStock, USDC …), and names a **basket of xStocks** (Backed's tokenised US equities on
  Solana: NVDAx, TSLAx, AAPLx, SPYx …) with fixed weights and a payout period.
- StonkFun charges 1% on every trade and forwards half of it — 0.5% — to the coin's creator, in the quote token.
  For a LINKR coin that creator is a **vault**.
- The vault converts the fees into the basket and pays them out to holders, **pro rata by time-weighted
  balance**, in Merkle epochs anyone can recompute.
- **0% platform fee.** Every harvested fee goes to holders.
- Live on Solana mainnet at **linkrfun.xyz** custodial and unaudited. Open source, GPL-3.0.

---

## 1. Positioning

### The one-liner

> Every market starts with a reason. LINKR launches coins on StonkFun around an idea, and pays their holders in
> the tokenised stocks the idea is about.

### The positioning statement

For **creators who launch coins around a narrative** and **holders who want more than a chart**, LINKR is the
layer on top of StonkFun that gives a coin a *reason*: a basket of real tokenised equities its trading fees buy
and distribute. Unlike a plain launch, where creator fees vanish into a wallet, LINKR's fees come back to
holders as stock — measured, published, verifiable.

### Category

A **dividend layer for StonkFun coins** (not a launchpad — StonkFun is the launchpad; not a DEX — Raydium
LaunchLab, the Raydium pool after graduation and Jupiter are the venues). What LINKR owns is the *vault*: who the creator is, what happens to the fees, and how
holders are paid.

---

## 2. Why Solana, why StonkFun, why now

| Fact | Why it matters to LINKR |
| --- | --- |
| StonkFun launches coins on Raydium LaunchLab all day and pays **0.5%** of every curve trade (half of its 1% fee) to the coin's creator, in the quote token | A recurring cash flow exists for every coin; almost none of it reaches holders |
| LaunchLab's `initialize_with_token_2022` takes a `creator` separate from the payer, and StonkFun forwards fees to whatever wallet the pool names | A keeper-owned vault can *be* the creator with no change to StonkFun |
| StonkFun lets a coin be quoted in an xStock, USDC or SOL | A coin about NVDA can trade — and pay its creator — in NVDAx itself |
| xStocks put NVDA, TSLA, AAPL, SPY and 600+ more on Solana as ordinary Token-2022 mints | "Paid in stock" is a token transfer, not a promise |
| Jupiter routes SOL, USDC and xStocks into other xStocks with real depth | Fees can be converted in one transaction, sized to the market |
| Solana transactions cost ~$0.0005 | Harvests, swaps, memos and deliveries are affordable every hour, for every vault |

---

## 3. The problem, told three ways

**For the creator** — you launch on StonkFun, the coin trades, the creator fee lands in your wallet, and the
coin's only story is its chart. There is nothing that makes *holding* better than *trading*.

**For the holder** — you bought the idea (AI, memory, space, a stock split) but you hold a coin that pays
nothing and whose fees leave. Being right about the narrative is not enough.

**For the ecosystem** — tokenised equities exist on-chain, but nothing routinely puts them into ordinary
wallets. The rails are there; the reason to use them is not.

---

## 4. What LINKR is

### A · Discover (`/`)

The thesis gallery: themes like *The AI Stack*, *American Defense* and *Musk Economy* with the stocks they live in,
live NVDAx market activity (pool data from GeckoTerminal), the newswire, and how a coin's fees become its holders'
stocks. Themes are editorial inspiration, labelled as such, never launched markets or recommendations.

### B · Create: the launch studio (`/launch`)

Coin details → quote token (any StonkFun pair) → stock rewards (up to ten allowlisted xStocks, weights by drag,
payout period) → review → two wallet transactions: prepare the vault, launch on StonkFun with the vault as creator.
Costs the creator account rent only (≈ 0.0113 SOL for the coin, a few thousandths of a SOL for the vault's
accounts); StonkFun charges no launch fee on this path. No LINKR fee. The Telegram bot (@linkrfun_bot) runs the
same launch from a chat.

### C · Markets and coin pages (`/vaults`, `/vaults/:vault`)

Every LINKR coin, and each coin's page. The vault is the coin's creator. Every period: forwarded fees picked up →
converted from the quote into the basket through Jupiter → holders' shares computed by time-weighted balance →
payout published (Merkle root on-chain) → review window → airdropped. The page shows fees waiting, conversions,
payouts, a live timeline for every step with its wall-clock time, and the creator's controls (harvest now, cancel a
payout inside the review window).

### D · Portfolio (`/claims`)

Everything the connected wallet earns across every LINKR coin: what is on its way (and the minute it lands), what
is still building up, and what was delivered. Shares under $1 add up until they are worth sending; *Send now*
delivers them right away. Explanations behind every term.

### E · Newswire (`/news`)

A live newswire read against xStocks: each story linked to the tickers it touches, prices beside the headline,
an optional model reading of what it changes. Feeds that are down say so.

---

## 5. How it works, in plain English

**Journey 1 — the creator.** Pick a name and a logo, pick the quote token, pick the stocks the idea is about and
how to weight them, pick how often holders get paid. Sign twice. The coin is live on StonkFun like any other; the
vault page shows
fees arriving and turning into stock. Flip on automatic delivery and holders never have to click.

**Journey 2 — the holder.** Buy the coin on StonkFun. Open the Portfolio: it shows your projected share of the
current period, the moment the period closes, when the keeper publishes, the review window, and the exact time
you can claim. Claim by signing a message (custodial) or a transaction (program); the stock lands in your wallet.

**Journey 3 — anyone.** Every payout's leaves are public. Recompute the root, compare it with the on-chain
commitment, check your allocation and everyone else's.

---

## 6. What makes it different

| | LINKR | A plain StonkFun launch | "Rev-share" bots |
| --- | --- | --- | --- |
| Where creator fees go | A vault → xStocks → holders | The creator's wallet (or, in reward mode, a transfer tax to holders in the coin's quote) | The bot's wallet → SOL to some holders |
| What holders receive | Real tokenised stock, in their wallet | Nothing | SOL, at the operator's discretion |
| How shares are computed | Time-weighted balance over the period | — | Snapshots, often opaque |
| Verifiability | Merkle root committed on-chain, every leaf public | — | Rarely |
| Platform fee | **0%** | — | Typically 5–20% |
| Upgrade path | Custodial today; the same accounting enforced by the `causa_vault` program when funded | — | — |

---

## 7. Economics — how money moves

```
trade on StonkFun ──1%──▶ StonkFun sweeper ──forwards 0.5%──▶ vault (in the quote token)
                                                                  │ 0% platform fee
                                                                  ▼
                                                        Jupiter: quote → basket
                                                                  │
                                                                  ▼
                                           time-weighted split ──▶ holders' wallets (xStocks)
```

**Worked example.** A coin quoted in SOL does 100 SOL of volume in a day on the bonding curve → 0.5 SOL forwarded
to the vault → the keeper converts it into the basket (say 60% NVDAx, 40% TSLAx) → at the period's end every
holder's balance-seconds are summed and the stock is split pro rata → delivered or claimed. A holder with 5% of the
time-weighted supply receives 5% of the stock. A coin quoted in TSLAx is paid in TSLAx, and a basket leg equal to
the quote needs no swap at all. Nothing is kept by LINKR.

**What StonkFun's forward means.** The creator's share is an off-chain forward by StonkFun (its platform sets
LaunchLab's on-chain creator fee to 0 and sweeps the fee itself). If StonkFun pauses forwarding, dividends pause.
Whether the share continues after a coin graduates into its Raydium pool is an open question with StonkFun.
LINKR uses StonkFun's *standard* mode only: *reward* mode pays a transfer tax to holders directly and leaves the
creator — the vault — with nothing to convert.

**What the operator pays.** Transaction fees for harvests, swaps, memos and deliveries, plus token-account rent
for holders who never held a given stock (≈ 0.002 SOL each, gated by a minimum-value policy). That is the cost of
running a keeper; it is not recouped from holders.

**Revenue.** None by default (`PROTOCOL_SHARE_BPS=0`). The vault supports a protocol share, capped at 20%, if
that ever changes — the site would say so in the same places it now says 0%.

---

## 8. Trust, honestly

LINKR runs vaults in one of two modes; the site says which.

- **Custodial (current).** Each vault is a wallet only the keeper can reconstruct. Between harvest and delivery
  LINKR holds the fees and the stock. Every payout's root is committed on-chain and every leaf is public, so a
  wrong payout is provable — but not prevented — by code. This is what the custodial notice is about.
- **Program.** The `causa_vault` program owns every vault and enforces the accounting: measured swaps, Merkle
  claims, review and claim windows, nobody can move funds outside the rules. It costs a ≈ 2.1 SOL refundable
  deposit to deploy and is the upgrade path once the product has earned it.

In both modes: the coin's liquidity is never touched (it is on StonkFun / Raydium); holders' delivered stock is theirs;
the creator has no special power over the vault; xStocks are issued by Backed, not LINKR.

---

## 9. Proof points

- Full loop verified on devnet with real Raydium LaunchLab coins on LINKR's own devnet platform (custodial mode):
  launch with the vault as creator → bind → creator fee claim → harvest → swap → epoch → publish → delivery.
- Earlier, the same loop in program mode and custodial mode on pump.fun, before the move to StonkFun.
- LiteSVM lifecycle test of the program; vitest coverage of time-weighted balances and Merkle proofs.
- Jupiter → NVDAx swap route measured on mainnet: three lookup tables, 868 bytes.
- Mainnet deployment live in custodial mode; the StonkFun spike (does StonkFun adopt a pool whose creator is not
  the payer, and forward fees to it?) and the dress rehearsal with real amounts are pending.

---

## 10. Brand

### 10.1 The name

**LINKR**: the link between an idea and the market it moves. Price, movement and narrative are results; every
market starts with a reason, and LINKR gives that reason a coin, linked to the stocks it is about.

- **The wordmark is `LINKR`**, set in capitals.
- **The mark** is two open, interlocking links in cobalt glass with one warm edge: two ideas, connected. The vector
  lives in `web/app/icon.svg` (and `BrandMark` in `web/components/site/brand.tsx`); the glass render is
  `web/public/brand/linkr-original.png`.
- **The coin is `$LINKR`**, launching on StonkFun. Its address goes in `NEXT_PUBLIC_LINKR_MINT`; until then the site
  shows "launching soon".

Written **LINKR** everywhere, in body copy too. On-chain identifiers keep the project's first name, CAUSA (the
`causa_vault` program, the `causa:v1:` memo prefix, key-derivation seeds): renaming them would move every vault to a
new, empty address.

### 10.2 Taglines

| Context | Line |
| --- | --- |
| **Primary** | Every market starts with a reason. |
| Product / hero | Discover the thesis. Hold the coin. Earn the stocks. |
| Eyebrow | Real ideas. Real connections. A more open financial system. |
| Creator-facing | Make your idea mean more. |
| Holder-facing | Your ideas. Your rewards. |
| Technical | StonkFun runs the coin. LINKR picks the basket. |
| Short social | One coin. Real stocks. On Solana. |
| Sign-off | Ideas connected. Possibilities multiplied. |

### 10.3 Elevator pitches

**8 words**: *Launch on StonkFun, holders earn real stocks.*

**25 words**: LINKR launches coins on StonkFun with a vault as their creator, so trading fees become a basket of
tokenised stocks airdropped to holders.

**60 words**: On Solana, NVDA and TSLA are ordinary tokens (xStocks), and StonkFun pays every coin's creator half
of its trading fee. LINKR joins the two: launch a coin around an idea, name the stocks it is about, and the fees
come back to holders as those stocks, split by how long they held. 0% platform fee. Verifiable on-chain.

**Boilerplate**: LINKR is a stock-rewards layer for StonkFun. A coin launched through LINKR names a basket of
tokenised US equities (xStocks) at launch; its creator fees are collected by a vault, converted into that basket
through Jupiter and airdropped to holders pro rata by time-weighted balance, in payouts committed on-chain as
Merkle roots that anyone can recompute. LINKR takes no fee. It ships as a single open-source application:
program, keeper, indexer, API, interface and Telegram bot.

### 10.4 Message house

```
          EVERY MARKET STARTS WITH A REASON. HOLDERS EARN STOCKS. 0% FEE.
   ┌──────────────────────┬──────────────────────┬──────────────────────┐
   │  1. A REASON         │  2. REAL EQUITIES    │  3. HONEST MATH      │
   ├──────────────────────┼──────────────────────┼──────────────────────┤
   │ a coin about an idea │ xStocks, in wallets  │ time-weighted, not   │
   │ StonkFun liquidity   │ no wrapper, no IOU   │ snapshots            │
   │ untouched            │ splits never move    │ Merkle root on-chain │
   │ creator has no keys  │ balances             │ every leaf public    │
   └──────────────────────┴──────────────────────┴──────────────────────┘
```

### 10.5 Voice and tone

**Voice:** clear, calm, quietly confident: short declarative lines, then the mechanism behind them. We explain how
it works; we do not sell outcomes.

| Do | Don't |
| --- | --- |
| State numbers that can be checked | Project APYs or returns |
| Say "stock rewards", "payouts", "distributions of creator fees" | Say "yield", "APY", "passive income" |
| Explain *why* a design choice was made | Assert that something is "the best" |
| Say what is custodial, unaudited or unfinished | Imply trustlessness or production-readiness before it is true |
| Use real amounts in examples | Use "moon", "degen", "ape" |
| Show the exact time something happens | Say "soon" or "any minute" (the one exception: a coin not launched yet) |

Three sentences that sound like LINKR:

> *"Every payout's root is on-chain and every leaf is public; check ours."*
> *"Custodial for now: between harvest and delivery you are trusting us, and the page says so."*
> *"0% platform fee. Every harvested fee goes to holders."*

Saying the uncomfortable thing plainly is the brand.

### 10.6 Vocabulary

| Use | Instead of |
| --- | --- |
| tokenised stock, xStock | synthetic stock, stock derivative |
| stock rewards, payout, distribution | yield, farm, staking |
| thesis, idea | narrative play, pump |
| basket | portfolio, index fund |
| period, epoch | round, cycle |
| time-weighted average balance (TWAB) | snapshot |
| harvest | compound, auto-compound |
| creator fee | tax, rake |
| airdrop (the keeper sends it), send now | claim, mint |

"Rewards" always means *distributions of creator fees* (§12.6), never a return on holding.

**Never write:** "guaranteed", "risk-free", "APY", "investment", "security", "share", "shareholder", "equity
stake", "dividend-paying stock" *(as a description of the coin itself)*. See §12.

### 10.7 Visual identity

A light, optical system: mineral white, cobalt glass and one warm signal. Ideas in motion, connected.

| Token | Role |
| --- | --- |
| Mineral white `#F6F9FD` | Ground |
| Ink `#102440` / `#091426` | Text, the wordmark |
| **Cobalt `#0967F6`** | The one accent: CTAs, the active step, links, the mark's body |
| Signal orange `#FF952A` | Used sparingly: connection nodes, "launching soon", the mark's warm edge |
| Positive `#147A59` / negative `#C44247` | Delivered and live states; errors |

**Surfaces.** Frosted glass panels with hairline borders and soft cobalt light; cards tilt a few degrees in the
hero and the thesis gallery.

**Typography.** **Manrope**, one family for everything, with tight tracking on display sizes. Contract addresses are
set in the system monospace so 0/O and l/I read apart.

**Motifs.** Connection lines with orange and blue nodes; tilted glass cards; the thesis card (theme artwork, its
tickers as chips); the **payout timeline**, four stops (period closes → published → review ends → in your wallet),
each with its wall-clock time.

**Icons.** LINKR's own line glyphs (`web/components/ui/icons.tsx`); brand marks (X, GitHub) from Phosphor.

**Imagery.** Theme artwork is concept illustration and is labelled as such. Charts show real data only (the hero's
NVDAx pool history comes from GeckoTerminal). No invented numbers.

**Assets.** `web/public/brand/`: the glass mark, the thesis artwork, the Telegram banner, and the bot's profile
photo (`linkr-avatar.png`) and description picture (`bot-description.jpg`); `web/app/opengraph-image.jpg` is the
link preview.

### 10.8 Ready-to-use copy

**GitHub "About":**
> Every market starts with a reason. StonkFun coins on Solana whose creator fees buy a basket of tokenised stocks
> (xStocks), airdropped to holders by time-weighted balance. 0% platform fee. Open source.

**X / Twitter bio (160 char):**
> Every market starts with a reason. Launch a coin, hold it, earn tokenised stocks. On Solana, 0% fee. Open
> source. Custodial, unaudited.

**Telegram bot (@linkrfun_bot):** its name, description and short description are set by
`web/scripts/telegram-setup.ts`.

**Repository topics:**
`solana` `stonkfun` `raydium-launchlab` `xstocks` `tokenized-stocks` `real-world-assets` `dividends` `anchor`
`jupiter` `nextjs` `typescript` `merkle` `creator-fees`

---

## 11. Audiences

| Audience | Their question | The answer that lands | Where they meet us |
| --- | --- | --- | --- |
| **Creators** | "How do I make my coin matter?" | Pay your holders in NVDA. Two signatures, then it runs itself. 0% fee. | StonkFun communities, `/launch` |
| **Holders** | "What do I get for holding?" | Real stock in your wallet, weighted by how long you held — with the exact time it arrives. | `/claims`, creator announcements |
| **Traders** | "Is there a reason to hold past the pump?" | The fees come back as stock; selling early forfeits the period. | Vault pages, the tape |
| **Ecosystem** | "Does this make xStocks useful?" | It puts them into ordinary wallets, every period. | Direct |
| **Auditors** | "Is the maths right and who holds the keys?" | Invariants, tests, a scoped brief, and a plain statement of the custodial trust. | `docs/AUDIT-CHECKLIST.md` |

### Launch narrative, in order

1. **StonkFun pays creators on every trade.** Almost none of it reaches holders.
2. **On Solana, stocks are tokens.** NVDAx is a transfer away.
3. **LINKR makes the vault the creator.** Fees → basket → holders. 0% fee.
4. **The proof:** a real payout, real amounts, the root on-chain, the leaves public.
5. **The invitation:** launch in two signatures.

---

## 12. Compliance guardrails for anything we publish

1. **Never** call the coin a security, share, equity or investment.
2. **Never** state or imply a return, yield, APY or "passive income" from holding.
3. **Never** describe LINKR as issuing or backing the equities; it distributes tokens issued by third parties.
4. **Never** claim an audit or trustlessness that has not happened; say **custodial** while it is custodial.
5. **Always** carry the custodial / unaudited notice wherever a user could be moved to spend.
6. **Always** describe payouts as *distributions of creator fees*, sourced from trading volume.
7. Historical figures are historical. Never annualise them.

---

## 13. Risks to say out loud

| Risk | Reality | Mitigation |
| --- | --- | --- |
| **Unaudited, custodial** | The largest one: LINKR holds fees and stock between harvest and delivery | Say it on every page; publish roots on-chain and leaves publicly; program mode as the upgrade path |
| **Regulatory** | Pro-rata stock distributions resemble dividends | Legal review; never call the coin a security or a share |
| **Thin stock liquidity** | Some xStocks pairs are shallow | Harvests are size-capped and halve on failure rather than dumping |
| **Keeper dependency** | Payouts need the keeper to harvest and publish | One secret, one cron, and a public trail; a stuck keeper delays, it does not lose |
| **Issuer powers** | xStocks can be paused or moved by the issuer | Same for every holder; deliveries retry |
| **StonkFun changes** | Fee schedule and the off-chain forward are theirs; forwarding after graduation is unconfirmed | Adapters isolated in `lib/stonkfun` and `lib/launchlab`; the vault is any address; the intake reads what actually arrived |

---

## 14. Status

| Area | State |
| --- | --- |
| Launch studio, markets and coin pages, portfolio, newswire, Telegram bot | Built |
| Custodial keeper (quote intake, Jupiter swaps, epochs, on-chain memo, deliveries, signed actions) | Built; verified end-to-end on devnet against LaunchLab (SOL-quoted; token-quoted intake written, untested on chain) |
| `causa_vault` program (program mode) | Built; LiteSVM lifecycle test; deployed on devnet — still reads pump.fun's curve, so program mode is deferred until a LaunchLab-aware build |
| Mainnet | **Live, custodial**: StonkFun forwards fees; first real payouts swapped through Jupiter and airdropped to holders on 19 Sep 2026 |
| Independent audit | Not started; brief in `AUDIT-CHECKLIST.md` |
| Legal review | Not started |
| $LINKR | Not launched; set `NEXT_PUBLIC_LINKR_MINT` when it is. The navbar ticker and the hero's address show "launching soon" until then |

---

## 15. Glossary

| Term | Meaning |
| --- | --- |
| **Basket** | The set of xStocks (up to 10, with weights) a vault converts fees into |
| **Bind** | The moment the keeper confirms a coin's LaunchLab pool names the vault as creator and starts the first period |
| **Creator fee** | The creator's half (0.5%) of StonkFun's 1% trade fee, forwarded to the coin's creator in the quote token |
| **Custodial mode** | Vaults are keeper-derived wallets; accounting is the keeper's, commitments are on-chain |
| **Epoch / payout** | One period's distribution, published as a Merkle root |
| **Harvest** | Picking up forwarded creator fees sitting on the vault and swapping them from the quote into the basket |
| **Merkle root** | One hash committing to every holder's allocation, so each can prove theirs |
| **Program mode** | Vaults owned and enforced by the `causa_vault` program (deferred until it reads LaunchLab pools) |
| **Quote token** | The token a StonkFun coin trades against — SOL, an xStock, USDC … — and the token its creator fees arrive in |
| **StonkFun** | The launchpad (stonkfun.xyz) whose coins run on Raydium LaunchLab; standard mode pays creators, reward mode does not |
| **Review window** | The pause between publishing and claiming during which a wrong payout can be cancelled |
| **TWAB** | Time-weighted average balance — how long you held, not just whether you held at a moment |
| **xStocks** | Backed's tokenised US equities on Solana (Token-2022, Scaled UI Amount) |

---

<div align="center">
<sub>LINKR · Product & Brand Book v2.1 · 2026-09-10 · Solana / StonkFun edition</sub>
</div>
