# Going live on Solana mainnet

LINKR on mainnet is the Next.js app with its cron routes (indexer + keeper), a MongoDB, and the vaults that
receive each coin's creator fees. Coin liquidity never touches LINKR — it lives on StonkFun / Raydium LaunchLab
(the bonding curve, then a Raydium CPMM pool after graduation).

Vaults can run in two modes (`NEXT_PUBLIC_VAULT_MODE`):

| | `custodial` (default for the soft launch) | `program` |
| --- | --- | --- |
| What a vault is | a wallet derived from the keeper secret; the LaunchLab pool records it as the coin's creator and StonkFun forwards creator fees to it | a PDA of the on-chain `causa_vault` program |
| Who enforces the accounting | the keeper (ledger in Mongo, every payout root written on-chain as a memo) | the program (measured balances, Merkle claims) |
| Trust | LINKR holds fees + stocks between harvest and delivery | nobody can move funds outside the program's rules |
| One-time cost | **≈ 0.15 SOL** (keeper float; no deploy) | ≈ 2.1 SOL refundable rent to deploy the program |
| Per launch (paid by the creator) | ≈ 0.001 SOL wallet floor + 0.002 SOL per stock account | ≈ 0.007 SOL rent + 0.002 SOL per stock account |
| Claim | wallet signs a message, keeper transfers (keeper pays holder token accounts) | holder's own transaction with a Merkle proof |
| Upgrade path | same vault addresses can be migrated at a period boundary | — |

The custodial path is what this guide describes and is the only supported mode today: the on-chain program is
unchanged by the StonkFun migration and its `bind_launch` still parses pump.fun's curve, so program mode is deferred
until a LaunchLab-aware build. Step 2 and the program-mode cost table are kept for reference.

## 0. What it costs (custodial)

| Item | Once | Ongoing |
| --- | --- | --- |
| Keeper wallet: transaction fees (≈ 0.000005 SOL each + an automatic priority fee, ≈ 0.0001 SOL), memo per payout, token-account rent for holders' deliveries (≈ 0.0016 SOL per new holder × stock, only above `DIVIDEND_AUTOCLAIM_MIN_USD` or on an explicit claim) and for accounts a swap route opens. Every swap also borrows a float (`KEEPER_SWAP_FLOAT_SOL`, 0.05 SOL) for the length of the transaction, so below ≈ 0.06 SOL swaps stop; the keeper logs a warning under `KEEPER_LOW_SOL` (0.05) | **0.15–0.3 SOL** | top up as it drains; `/admin` shows the balance |
| Dress rehearsal (one real coin: LaunchLab create rent ≈ 0.0113 SOL, no StonkFun launch fee, + dust trades) | ≈ 0.1 SOL | — |
| Helius RPC (indexer + keeper + browser) | — | free tier to start |
| Vercel | — | **Pro ($20/mo)**: the crons run every 1–2 minutes and Hobby only allows daily crons |
| MongoDB Atlas | — | existing cluster, new database `linkr-mainnet` |
| Jupiter swap API, Pinata (optional) | — | free |

Fund **≈ 0.3 SOL on the keeper wallet** (`71FyeDQG4Mj5tpPTSz7YP3pKc6AJ9UttFkW64AqMTeMJ`, created for this
StonkFun deployment; every custodial vault derives from it, so the pump.fun-era keeper is never reused) and keep the
admin wallet for later (it only matters for program mode). Below is the program-mode cost table for comparison.

### Program mode costs

| Item | Once | Ongoing |
| --- | --- | --- |
| Program deploy (413 KB, rent for the program data account) | ≈ 2.1 SOL, locked while the program exists (recoverable by closing it) | upgrades: a temporary buffer of the same size, refunded after |
| IDL account + `init_config` + one `allow_basket_mint` per stock | ≈ 0.05 SOL | — |
| Dress rehearsal (one real coin: LaunchLab create rent ≈ 0.0113 SOL, no StonkFun launch fee, + dust trades) | ≈ 0.1 SOL | — |
| Keeper wallet (transaction fees, ATA rent for automatic delivery ≈ 0.002 SOL per new holder-stock pair) | 0.5 SOL to start | top up as it drains; the dashboard shows the balance |
| Helius RPC (indexer + keeper + browser) | — | free tier to start; paid from ≈ $49/mo when traffic grows |
| Vercel | — | **Pro ($20/mo) is required**: the crons run every 1–2 minutes and the Hobby plan only allows daily crons |
| MongoDB Atlas | — | existing cluster, new database `linkr-mainnet` |
| Jupiter swap API | — | free (`lite-api.jup.ag`); a key from portal.jup.ag raises rate limits |
| Pinata (IPFS pinning for coin metadata) | — | free; set `PINATA_JWT` so launch metadata is pinned |

Fund **≈ 3.5 SOL on the admin wallet and 0.5 SOL on the keeper** before step 2.

**What is Helius?** A Solana RPC provider — a hosted node the app talks to. The public
`api.mainnet-beta.solana.com` endpoint rate-limits hard and blocks the history methods the indexer needs
(`getSignaturesForAddress`, batched `getParsedTransactions`), so production needs a provider. Helius
(helius.dev) has the best free tier for this; QuickNode or Triton work the same way. Sign up, create a
mainnet API key, and the URL is `https://mainnet.helius-rpc.com/?api-key=<key>`.

## 1. Keys and secrets

Dedicated mainnet keypairs, kept outside the repo:

- admin / upgrade authority: `~/.config/solana/causa-mainnet-admin.json`
- keeper (operator): `~/.config/solana/linkr-keeper-mainnet.json`
- program keypair: `solana/target/deploy/causa_vault-keypair.json` (same program id on every cluster)

Back all three up somewhere that is not this laptop. Losing the admin key means the program can never be
upgraded or paused; losing the keeper key only means rotating the operator in `/admin`.

## 2. Program (skip in custodial mode)

Custodial deployments have no program to deploy: the keeper key *is* the vault authority. Set the policy in
the environment instead (`PROTOCOL_SHARE_BPS`, `DISPUTE_WINDOW_S`, `CLAIM_WINDOW_S`, `MIN_EPOCH_LENGTH_S`,
`BASKET_ALLOWLIST`, `VAULT_PAUSED`) and go to step 3. The rest of this section is for `program` mode.

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd solana
anchor build --arch v0
solana config set --url https://mainnet.helius-rpc.com/?api-key=<key> --keypair ~/.config/solana/causa-mainnet-admin.json
solana balance                                    # ≥ 3.5 SOL
anchor deploy --provider.cluster mainnet --provider.wallet ~/.config/solana/causa-mainnet-admin.json
anchor idl init --provider.cluster mainnet --provider.wallet ~/.config/solana/causa-mainnet-admin.json \
  --filepath target/idl/causa_vault.json 99n7VGd6132b4UUwhSezLm9xXssdnJFiSPrEKkCuMHPF
```

Then the one-time configuration (operator = keeper, 5% protocol share, 10-minute review window, 180-day
claim window, 1-hour minimum period) and the initial xStocks allowlist:

```bash
cd ../web
cp .env.mainnet.example .env.local        # fill it in — see step 3
KEEPER_PUBKEY=$(solana-keygen pubkey ~/.config/solana/linkr-keeper-mainnet.json) \
PROTOCOL_RECIPIENT=<wallet that receives the 5%> \
npx tsx scripts/mainnet-setup.ts NVDA,TSLA,AAPL,MSFT,GOOGL,AMZN,META,SPY,QQQ,COIN,HOOD,MSTR,CRCL
```

Re-run it with more symbols any time; it skips what is already allowed. `/admin` (with the admin key in a
browser wallet) can do the same, plus pause, operator rotation and admin transfer.

## 3. Environment

`web/.env.mainnet.example` lists every variable with production values. The ones that must change from
devnet: `NEXT_PUBLIC_VAULT_MODE=custodial`, `BASKET_ALLOWLIST` (real xStocks tickers), `DISPUTE_WINDOW_S=600`,
`MIN_EPOCH_LENGTH_S=3600`, `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`, both RPC URLs (Helius), `MONGODB_DB=linkr-mainnet`,
`KEEPER_PRIVATE_KEY` (base58 of the mainnet keeper), `PROTOCOL_RECIPIENT`, `DIVIDEND_SWAP=jupiter`,
`DIVIDEND_MIN_HARVEST=0.05` (whole units of the vault's quote token), `DIVIDEND_DUST_UNITS=1000`,
`DIVIDEND_AUTOCLAIM_DELAY_S=600`, fresh `CRON_SECRET` / `ADMIN_SECRET`,
`NEXT_PUBLIC_SITE_URL`. Leave `LAUNCHLAB_PLATFORM_ID` unset on mainnet (it defaults to StonkFun's standard platform,
`4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7`); `LAUNCHLAB_RAISE` is devnet-only.

Vercel calls each cron route with `Authorization: Bearer $CRON_SECRET`, so set `CRON_SECRET` in the Vercel
project too. Never put `KEEPER_PRIVATE_KEY` in a `NEXT_PUBLIC_` variable.

## 4. Web app on Vercel

1. Import the GitHub repo, **root directory `web`**, framework Next.js, plan Pro (every push to `main`
   deploys production).
2. Paste the variables from `.env.local` into Project → Settings → Environment Variables (Production), or load
   `web/.env.mainnet.local` with `scripts/vercel-env-push.sh`.
3. Deploy. `web/vercel.json` registers the crons: `/api/cron/sync` every minute (indexer),
   `/api/cron/dividends` every 2 minutes (keeper), `/api/cron/stonkfun` every minute (StonkFun launch ledger +
   bound coins' pool state), `/api/cron/news` every 5 minutes.
4. Check Deployments → Functions → Crons after ten minutes: `sync` and `stonkfun` should be green; `dividends`
   reports `vaults=0` until the first launch.

StonkFun publishes no trade stream, so the home tape stays empty unless something fills the `trades` collection;
`/api/cron/stonkfun` only keeps the catalogue (`/launches`, `/tokens`, `/stats`; 300 req/min per IP, no key) and
bound coins' pool state fresh.

## 5. Dress rehearsal (before the link goes public)

With the site deployed and the keeper funded, do one real run end to end with small amounts:

1. `/launch` with the admin's browser wallet: a throwaway coin quoted in SOL, basket 100% NVDAx, period 1 hour,
   initial buy 0.02 SOL. Confirm the vault page shows the coin bound (the keeper does it within two minutes) and
   that StonkFun has adopted it at `https://www.stonkfun.xyz/token/<mint>` (a minute or two).
2. Buy 0.05 SOL of it from a second wallet on StonkFun (mainnet: the real site works).
3. Wait for the keeper: StonkFun forwards the creator's 0.5% into the vault's wrapped-SOL account in batches
   (an hour or two apart); the keeper unwraps it, and once the idle SOL clears
   `DIVIDEND_MIN_HARVEST`, *Fees waiting* drops to 0 and a harvest appears; a Jupiter swap follows within a few
   minutes (`/api/vaults/<vault>/harvests` lists both signatures).
4. After the period closes: epoch published → 10-minute review → claim from the second wallet, and confirm
   NVDAx arrives in that wallet (Token-2022 account, Solscan shows it as `NVDAx`).
5. Only then share the URL.

If any step misbehaves, `DIVIDEND_DRY_RUN=1` on Vercel makes the keeper simulate instead of send while you
look, and *Pause* in `/admin` stops every vault instruction except claims.

## 6. Telegram launch bot (optional)

The bot launches the same coins as `/launch`, from a Telegram chat. It runs inside the same deployment
(`/api/telegram/webhook`) and needs custodial mode.

1. Create the bot with @BotFather (`/newbot`) and copy its token.
2. Set on Vercel: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`) and
   `TELEGRAM_WALLET_SECRET` (`openssl rand -base64 48`). Redeploy.
3. Point the bot at the site: `cd web && ENV_FILE=.env.mainnet npm run telegram:setup` (sets the webhook with
   the secret, the command menu and the bot's profile text; prints the webhook URL and any delivery error).
4. Rehearse it like the site: `/launch` in a private chat, fund the bot wallet with ~0.05 SOL, launch with a
   0.02 SOL initial buy, and check the vault page. Then try *Sign with my own wallet* on the same kind of draft:
   the wizard opens prefilled, and the chat hears when the coin is live.

`TELEGRAM_WALLET_SECRET` seeds every user's bot wallet (nothing else is stored): back it up with
`KEEPER_PRIVATE_KEY`, never change it once users have funded wallets (the bot refuses to run with a different one
rather than hand users empty wallets), and never reuse the keeper key for it. Locally, use a second bot token and
`npm run telegram:dev` (long polling); it refuses to take over a bot that has a webhook.

## 7. Day-two

- Watch the keeper balance (`/admin` shows it); auto-delivery pays ATA rent for holders.
- `DIVIDEND_EXCLUDED` takes extra addresses to exclude from payouts (market makers, the team wallet).
- Creator fees are an off-chain forward by StonkFun (its platform sets LaunchLab's on-chain creator fee to 0):
  if StonkFun pauses forwarding, harvests pause. Whether the share continues after graduation into the CPMM pool
  is open (`cpmmCreatorFeeOn: 0`) — ask StonkFun.
- Upgrades: `anchor build --arch v0 && anchor upgrade target/deploy/causa_vault.so --program-id 99n7…` with the
  admin key, then `node scripts/export-idl.mjs` and push.
