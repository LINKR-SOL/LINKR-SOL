# LINKR web

Next.js 16 (App Router) application: the site, the REST API, the indexer and the dividend keeper, all in one
deployable. See the root [README](../README.md) for the product, environment variables and deployment, and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how the pieces fit.

Key folders:

- `app/` — pages (`/`, `/news`, `/launch`, `/vaults`, `/claims`, `/admin`) and `app/api/` route handlers
  (REST, cron endpoints for the indexer / keeper / StonkFun catalogue / newswire)
- `components/` — `site` (nav, bands, footer), `causa` (hero, cinematic sections), `news`, `terminal`, `launch`
  (wizard, quote picker), `vaults` (vault page, claims, payout and binding clocks), `ui` (primitives, tooltips,
  live times)
- `lib/solana/` — cluster + vault-mode switch, connection, program client and PDAs, instruction builders,
  keeper wallet, transaction sender
- `lib/custody/` — custodial vault mode: derived vault keys, env policy, Mongo ledger, keeper (idle-quote intake,
  Jupiter swaps, epochs, deliveries), signed actions
- `lib/launchlab/` — Raydium LaunchLab: program ids, StonkFun pairs (quote tokens), pool reader, launch pricing,
  `initialize_with_token_2022` transaction builder
- `lib/stonkfun/` — StonkFun public API client (`/tokens`, `/launches`, `/stats`), live feed reader (home tape,
  pulse, per-coin market), types
- `lib/jupiter/`, `lib/xstocks/` — quotes and swap instructions; Backed's xStocks registry, Token-2022 extension
  reader, prices
- `lib/indexer/` — program signature walk and event ingestion, per-coin balance streams, shared epoch builder,
  dividend keeper (program mode), chain refresh
- `lib/dividends/` — time-weighted average balances, Merkle tree, harvest quoting (from any quote token),
  excluded owners
- `lib/news/` — the newswire: collect, dedupe, link to xStocks tickers, Insight enrichment, store
- `scripts/` — LaunchLab devnet e2e, devnet platform setup, mainnet setup and spike, spikes, Vercel env push
- `lib/token.ts` — `$LINKR` name, ticker and mint (from `NEXT_PUBLIC_LINKR_MINT`): the single source of truth for the ticker, the hero's address and every "Buy" link
- `public/brand/` — monogram, banner and social artwork

StonkFun publishes no trade stream, so there is no WebSocket worker: the home tape reads the `trades`
collection and stays empty (never faked) unless something fills it.

```bash
cp .env.example .env.local   # fill in Mongo, RPC, keeper key, secrets
npm install
npm run dev                  # http://localhost:3001
npm run dev:all              # + local cron loop (indexer, keeper, StonkFun catalogue)
npm test                     # vitest: TWAB replay, Merkle proofs
npm run platform:devnet      # once: LINKR's own LaunchLab platform on devnet → LAUNCHLAB_PLATFORM_ID
npm run e2e:devnet           # devnet: vault → LaunchLab coin → fees → payout → delivery
```
