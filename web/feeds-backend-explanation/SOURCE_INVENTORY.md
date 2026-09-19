# Thesis Radar — non-X source inventory and request reference

**Purpose.** This is the exact non-X information map for Thesis Radar: what it reads, the request it makes, what fields it retains, and whether that data can page Telegram.

**Scope exclusion.** X/Twitter and its Apify tasks are deliberately excluded from this document. They are a separate social-source lane. No X token, actor name, task ID, query, account list, or payload is recorded here.

**Security rule.** Tokens, passwords, cookies, session IDs, and HAR request values are never placed in this file. A HAR is used to identify a stable endpoint and public request shape; it is not replayed with the operator's browser session.

## 1. What counts as an alert now

The bot is not supposed to alert merely because a token exists or has market cap.

For a normal Telegram alert, the candidate must have all of the following:

1. A publication timestamp and an age inside `--max-age-minutes` (currently 20 minutes in the live container).
2. A concrete market linkage: an explicit stock, ETF, or crypto asset reference, resolved to an xStock on Solana. Examples: `Robinhood` → `$HOOD`, `AMC` → `$AMC`, `Tesla`/`Elon Musk` → `$TSLA`, `Nvidia` → `$NVDA`, `Fed` → `$SPY`.
3. A primary provenance source. Chain/indexer sources alone are not accepted as primary provenance.
4. The live score/gate must pass. Promotion, stale stories, exact duplicate identities, and very late token market caps are rejected.

`SOURCE_CHAIN_BACKFILL=0` and `NOTIFY_CHAIN_BACKFILL=0` are the intended production settings. The former prevents the historical “missed narrative” scan from running; the latter makes the same lane audit-only if it is ever enabled. It must not send Telegram cards.

### Source classes

| Class | Meaning | Can establish a thesis by itself? |
|---|---|---|
| Primary news/social | A timestamped report, public article, RSS item, or social post | Yes, if all gates pass |
| Structured market | Exchange/market/filing/halts/probability data | Supports or cross-confirms a thesis |
| Chain/indexer | Pool, pair, token profile, market-cap or DEX metrics | No — confirmation only |
| AI enrichment | OpenRouter analysis of evidence already collected | No — advisory follow-up only |

## 2. Shared request conventions

The collector uses Python `urllib`; it does not use a browser automation session for the feeds below.

| Helper | Request | Headers / retry | Used by |
|---|---|---|---|
| `request_json` | `GET`, JSON | `Accept: application/json`, `User-Agent: ThesisRadar/0.1`, 15s timeout | Public JSON APIs |
| `request_json_retry` | `GET`, JSON | Browser-like UA, optional `Referer` + same-origin `Origin`; retries HTTP 429/502/503/504 up to three times | Stocktwits, StonkFun |
| `request_json_post` | `POST`, JSON | `Accept: application/json`, JSON `Content-Type`, supplied `Referer` + matching `Origin`, 15s timeout | Barchart |
| `request_bytes` | `GET`, RSS/XML | RSS/XML `Accept`, `User-Agent: ThesisRadar/0.2`, 15s timeout | Google News, Nasdaq |
| `request_bytes_with_agent` | `GET`, RSS/Atom | RSS/XML `Accept`, operator-selected user-agent, 15s timeout | SEC, configurable RSS |
| `request_text` | `GET`, HTML | Browser-like UA, optional referrer, 15s timeout | Yahoo Finance, ForexFactory, article image fallback |

Source failures are recorded in SQLite table `source_runs` with source, lane, start time, latency, item count, and error. `shadow-report` exposes per-source health, mean lag, and count of signals found under 20 minutes.

## 3. Primary news and culture sources

### 3.1 Google News RSS — enabled

- **Role:** Broad discovery and the second-pass source-network lookup. It is an aggregator, not proof of the globally first publisher.
- **Endpoint:**

  ```text
  GET https://news.google.com/rss/search?q={urlencoded_query}&hl=en-US&gl=US&ceid=US:en
  ```

- **Configured query payload:** `GOOGLE_NEWS_QUERIES` is a pipe-separated list. Built-in defaults:

  ```text
  ("went viral" OR "internet is obsessed") (animal OR mascot OR celebrity) when:1h
  (named OR mascot) (dog OR cat OR raccoon OR robot) viral when:1h
  (Elon OR Tesla OR OpenAI OR NASA) (mascot OR meme OR viral) when:1h
  ```

- **Response parsing:** RSS `title`, `link`, `pubDate`, `source`, and description/snippet.
- **Candidate fields:** headline, summary, article URL, publisher name, publication age, extracted entities.
- **How it is used:**
  - normal discovery in the culture/news lane;
  - `build_source_network()` queries `"{candidate token/name}" when:1d` for up to eight timestamped corroborating articles;
  - source-network evidence is supplied to OpenRouter and may identify a publisher to add via RSS/API later.
- **Limit:** Google’s result time is not a guarantee that it was the original publication. The card correctly says *Primary monitored source*, not “global first source.”

### 3.2 Hacker News Firebase API — enabled

- **Role:** Early technical / internet-native narratives and Show HN stories.
- **Requests:**

  ```text
  GET https://hacker-news.firebaseio.com/v0/newstories.json
  GET https://hacker-news.firebaseio.com/v0/item/{id}.json
  ```

- **Payload/query:** None. `HN_LIVE_LIMIT` controls the number of IDs read (default 30; hard range 1–100).
- **Response fields used:** `type`, `title`, `url`, `time`, `score`, `descendants`.
- **Candidate transformation:**
  - only `type == "story"` with a title;
  - `time` becomes the UTC publication timestamp;
  - summary includes HN points/comments;
  - raw HN discussion link is retained for review.
- **How it is used:** Primary source only if it also passes timestamp, market-linkage, score, and duplicate gates. An HN post on its own does not prove an external news event.

### 3.3 Yahoo Finance — enabled

- **Role:** Broad market/business/stock-news discovery.
- **Endpoint:**

  ```text
  GET https://finance.yahoo.com/
  ```

- **Why this endpoint:** The supplied HAR showed Yahoo’s public, server-rendered story stream. The bot deliberately does **not** call its logged-in notification API.
- **Payload/query:** None.
- **Response parsing:** HTML story sections; article link, `<h3>` headline, `published-date` relative label, summary, image URL, and ticker labels.
- **Freshness parsing:** Explicit `Xm ago`, `Xh ago`, and `Xd ago` labels are converted to minutes. Stories with no usable relative timestamp are dropped.
- **Candidate fields:** title, article URL, summary, image, ticker/entity hints, timestamp/age; lane `market`, tier 2.
- **How it is used:** Primary market-news source. It still needs an actionable market linkage and score to send Telegram.
- **Known limitation:** Yahoo aggregates articles from many publishers. The card should be read as “Yahoo monitored this first for us,” not necessarily “Yahoo wrote it first.”

### 3.4 Stocktwits News API — enabled; server health must be watched

- **Role:** Fast stock/crypto headline stream tied to symbols.
- **Endpoint:**

  ```text
  GET https://api-gw-prd.stocktwits.com/news/v2/articles
  ```

- **Query payload:**

  ```text
  collapse=true
  sorted_news_count={STOCKTWITS_NEWS_LIMIT, clamped 3..30}
  source_id={STOCKTWITS_NEWS_SOURCE_ID, default 1071}
  symbols={one repeated parameter per symbol, maximum 25}
  ```

  Default configured symbols: `SPY, QQQ, BTC.X, AAPL, TSLA, MSFT, NVDA, HOOD, AMC, GME`.

- **Headers:** JSON accept, browser-like UA, `Referer: https://stocktwits.com/`, `Origin: https://stocktwits.com/`; no cookie or login is sent.
- **Response fields used:** `headline`, `summary`/`meta_description`/`content`, `canonical_url`, `created_at`, `updated_at`, `image_url`, `featured_image`, `author`, `source`, and `symbol_codes`.
- **How it is used:** Primary market-news source; symbols become entity hints for linkage and cross-lane clustering.
- **Known limitation:** The endpoint was verified from HAR locally. In the first server cycle it returned HTTP 403. The adapter now supplies origin/referrer, but `shadow-report` must confirm it is returning items before treating it as a live source. It is safe to leave enabled: a 403 records source health and produces no card.

### 3.5 Barchart News — enabled

- **Role:** Public market-news stream including AP and Barchart contributors.
- **Endpoint:**

  ```text
  POST https://www.barchart.com/news/load-more-stories
  Referer: https://www.barchart.com/news
  Origin:  https://www.barchart.com
  Content-Type: application/json
  ```

- **JSON request payload:**

  ```json
  {
    "before": 0,
    "section": "overview",
    "subSection": "",
    "search": [],
    "useThumbnail": false,
    "symbolType": false
  }
  ```

  At runtime `before` is replaced with the current Unix timestamp.

- **Response parsing:** top-level `items` may itself be a JSON-encoded string. Per item: `id`, `slug`, `title`, `feedName`, and `published`.
- **Candidate transformation:** Builds canonical story URL:

  ```text
  https://www.barchart.com/story/news/{id}/{slug}
  ```

  Barchart Central-Time labels such as `Thu Sep 3, 2:41PM CDT` are converted to UTC age.
- **How it is used:** Primary market-news source if fresh and linked to a recognised asset. It is not automatically trusted as a first publisher; `feedName` can be AP or another upstream wire.

### 3.6 Configured culture RSS — enabled

- **Role:** Internet culture / visual seeds that may cross with market news.
- **Default endpoints:**

  ```text
  GET https://rss.upi.com/news/odd_news.rss
  GET https://www.goodnewsnetwork.org/category/news/animals/feed/
  ```

- **Additional feed configuration:** `CULTURE_RSS_FEEDS` supports entries separated by `|`:

  ```text
  Name::https://example.com/feed.xml::culture::2
  ```

  Fields: display name, URL, lane (default `culture`), source tier (default 2).

- **Response fields used:** RSS/Atom title, description/content, link, `pubDate`/`date`, optional image enclosure.
- **How it is used:** A culture seed may be queued for enrichment, but will not page Telegram unless it also has a concrete stock/ETF/crypto linkage. This prevents “random meme” spam.

### 3.7 Discovered RSS registry — conditional

- **Role:** Automatically preserved feeds discovered from a legitimate news source during source-network/backfill investigation.
- **Registry file:** `data/source_registry.json`.
- **Auto-registration policy:**
  - accepts only explicit RSS/XML/feed URLs;
  - records a recognised news article host as `needs_rss_or_api_endpoint` but does not scrape the arbitrary article page as a permanent feed;
  - ignores token/project/landing sites, DEX pages, chain explorers, and arbitrary unrelated URLs.
- **Request:** exactly the RSS URL in the registry via `GET`, same parser as configured RSS.
- **How it is used:** Adds a discrete `Discovered RSS #N` collection run. It is not a silent permission to monitor a project website.

### 3.8 ForexFactory Calendar — disabled by default

- **Role:** Optional macro-release confirmation, not a breaking-news wire.
- **Endpoint:**

  ```text
  GET https://www.forexfactory.com/calendar
  ```

- **Payload/query:** None.
- **Response parsing:** Public HTML rows with `data-event-id`, `data-day-dateline`, event title, actual value, and high-impact (`impact-red`) marker.
- **Filtering:** Only high-impact rows with an actual released value; future rows are ignored.
- **Candidate fields:** `Macro release: {event}`, actual value, timestamp based on the public event dateline, `macro_release=true`.
- **Enable flag:** `SOURCE_FOREXFACTORY=1`.
- **Reason it is disabled:** Calendar events create too much predictable noise unless the operator explicitly wants macro-release alerts.

### 3.9 SEC EDGAR current filings — disabled by default

- **Role:** Official filing confirmation for watched companies/topics.
- **Endpoint:**

  ```text
  GET https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&count=100&output=atom
  ```

- **Required configuration:** `SEC_USER_AGENT` must be a descriptive contact string. The collector deliberately returns no items when it is missing.
- **Filter payload:** `SEC_WATCH_TERMS`, comma-separated, default example: `TSLA,OPENAI,NVDA,META`.
- **Response fields used:** Atom title, summary, link, date.
- **Candidate marker:** `market_signals.filing=true`, market lane, tier 1.
- **Enable flag:** `SOURCE_SEC_EDGAR=1`.
- **Why it is a confirmation source:** A filing can be highly material but may not be memetic. The normal linkage/score gates still apply.

### 3.10 Narrative Radar API — disabled by default

- **Role:** Legacy optional narrative feed.
- **Endpoint:**

  ```text
  GET https://narrativerdr.rest/api/radar
  ```

  Configurable with `NARRATIVE_RADAR_URL`.

- **Response parsing:** accepts list/object forms with `latest`, `data`, `items`, `coins`, `pairs`, `results`, or `narratives`; normalises headline, summary, links, timestamp, image, engagement, lane, and entities.
- **Enable flag:** `SOURCE_NARRATIVE_RADAR=1`.
- **Why it remains disabled:** Prior tests over-concentrated on CoinDesk/Cointelegraph and did not improve first-source speed. It is backup only, not a primary live source.

### 3.11 FinancialJuice — investigated from HAR, not integrated

- **Observed public-looking endpoints in the supplied HAR:**

  ```text
  GET https://live.financialjuice.com/FJService.asmx/Startup
  GET https://live.financialjuice.com/FJService.asmx/GetPreviousNews
  GET https://live.financialjuice.com/FJService.asmx/GetNewsSummary
  ```

- **Observed response data:** `Startup` includes `News`, `Cal`, `History`, `Summary`, `CEvents`, and `MarketData`. News items contain fields such as `NewsID`, `Title`, `Description`, `DatePublished`, `Breaking`, `TickerIDs`, `FCName`, and image/link fields.
- **Why it is not deployed:** The HAR requests include an opaque, session-like `info` query value and tab/session state. Reusing that value on a server would amount to replaying browser-session traffic; it will expire and is not an acceptable production integration.
- **What is needed to add it safely:** an official API key/documented endpoint, a public RSS endpoint, or a HAR showing a stable anonymous request with no session-bound parameter. Until then it is not a collector source and cannot affect Telegram.

## 4. Structured market, chain, and duplicate-check sources

These sources provide market/chain evidence. They cannot independently create a Telegram thesis because `has_alert_provenance()` treats chain/indexer sources as confirmation only.

### 4.1 Nasdaq Trade Halts RSS — enabled

- **Endpoint:**

  ```text
  GET https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts
  ```

- **Payload/query:** `feed=tradehalts`.
- **Response parsing:** standard RSS title, description, link, publication date.
- **Candidate marker:** `market_signals.halt=true`, tier 1, market lane.
- **Use:** Strong structured evidence for a fresh company-specific catalyst, never a meme thesis by itself.

### 4.2 xStocks prices (Jupiter Price API) — enabled

- **Endpoint per batch of mints:**

  ```text
  GET https://lite-api.jup.ag/price/v3?ids={comma-separated-xStock-mints}
  ```

  (`api.jup.ag` with `x-api-key` when `JUPITER_API_KEY` is set; GeckoTerminal `networks/solana` as fallback.)

- **Input configuration:** the xStocks registry snapshot (`web/lib/stock-tokens.generated.ts`, from Backed's public assets API), mapped ticker → mint (`NVDA` → `NVDAx`).
- **Response fields used:** USD price per mint; the Token-2022 Scaled UI Amount multiplier is read on-chain (`web/lib/xstocks/extensions.ts`) and applied for display only.
- **Candidate marker:** live price beside a linked ticker, tier 1, market lane.
- **Rate-limit behavior:** batched requests, short in-memory cache; a stale copy is served flagged `stale` while the API is down.

### 4.3 Polymarket Gamma API — enabled

- **Endpoint:**

  ```text
  GET https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false
  ```

- **Response fields used:** `question`/`title`, `slug`, `updatedAt`, `oneHourPriceChange`, `oneDayPriceChange`, `image`, `icon`.
- **Filter:** absolute 1h or 1d probability move must be at least 8%.
- **Candidate marker:** `market_signals.prediction_move`, market lane, tier 1.
- **Use:** Measures a material belief/probability move. It is confirmation rather than an original source.

### 4.4 GeckoTerminal new Solana pools — enabled

- **Endpoint:**

  ```text
  GET https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token&page=1
  ```

- **Response fields used:** pool address/name/creation time/reserve; 5-minute buys and volume; linked base-token name, symbol, image.
- **Candidate marker:** `new_pool`, `buys_5m`, `volume_5m`, `liquidity_usd`; chain lane, tier 1.
- **Use:** Detects fresh Solana liquidity and validates a candidate after a primary source exists. It cannot cause an alert by itself.

### 4.5 DexScreener — duplicate checking and Solana pair evidence

#### A. Token identity duplicate search

- **Endpoint:**

  ```text
  GET https://api.dexscreener.com/latest/dex/search/?q={URL-escaped-proposed-ticker-or-name}
  ```

- **Use:** Fallback if the StonkFun catalogue lookup is not configured/available. The result is checked for exact name/ticker collisions and similarity >= 0.82.
- **Effect:** Exact duplicate rejects the candidate; similar duplicate penalises its score.

#### B. xStocks pair scan on Solana — optional

- **Endpoint:** Same DexScreener search endpoint, called once for each configured stock symbol.
- **Default symbols:** `AMC,GME,MSTR,NVDA,TSLA,SPCX,HIMS,LLY,AAPL,GOOGL,META,HOOD` (as `…x` xStocks).
- **Concurrency:** Up to eight workers.
- **Response fields used:** `chainId`, base/quote token, `pairCreatedAt`, 5m transactions, 5m/24h volume, liquidity, market cap/FDV, price, image, pair URL.
- **Filter:** `chainId == solana` and the pair involves one of the configured xStocks mints.
- **Candidate marker:** stock paired; 5m buys/volume/liquidity/market cap; chain lane, tier 1.

#### C. Solana profile/boost discovery — enabled

- **Requests:**

  ```text
  GET https://api.dexscreener.com/token-profiles/latest/v1
  GET https://api.dexscreener.com/token-boosts/latest/v1
  GET https://api.dexscreener.com/tokens/v1/solana/{comma-separated-token-addresses}
  ```

- **Flow:** read latest profiles and boosts → keep `chainId == solana` entries with a `tokenAddress` → batch them into the Solana pair endpoint → join pair metrics to profile description, links, icon/header, name and symbol.
- **Use:** Detects new Solana pairs and supplies chain confirmation. It cannot establish primary provenance.

#### D. Historical narrative backfill — disabled / audit-only

- **Underlying requests:** the profile/boost discovery calls above.
- **Candidate filter:** market cap >= `BACKFILL_MIN_MARKET_CAP_USD` (default $150,000), age <= `BACKFILL_MAX_AGE_MINUTES` (default 1,440), and a stock/market cue.
- **Important:** `SOURCE_CHAIN_BACKFILL=0` and `NOTIFY_CHAIN_BACKFILL=0`. It must not create a Telegram card. If manually enabled, it is a post-mortem dataset that asks “which old launches did we miss?”

### 4.6 StonkFun catalogue — first-party chain confirmation

- **Requests** (StonkFun public API, documented at https://www.stonkfun.xyz/developers; no key, 300 requests/min per IP, `Accept: application/json`):

  ```text
  GET https://www.stonkfun.xyz/api/public/v1/launches?limit=25&page={n}     launch ledger, newest first, 25 rows a page — the only place a coin's creator is named
  GET https://www.stonkfun.xyz/api/public/v1/tokens?sort=newest|marketCap|volume24h&status=new|aboutToGraduate|graduated&quote={mint}&limit=100
  GET https://www.stonkfun.xyz/api/public/v1/tokens/{mint}
  GET https://www.stonkfun.xyz/api/public/v1/stats
  GET https://www.stonkfun.xyz/api/public/v1/pairs                          launchable quote tokens (used by the launch wizard, not by the collector)
  ```

- **Response fields used:** mint, pool (LaunchLab pool while on the curve, Raydium pool after), creator, quote token (mint, symbol, category), launchpad, mode (`standard` / `reward`), name/symbol/image, USD price / market cap / 24h volume, status and graduation progress, creation time.
- **Filters:** launches whose `creator` is a CAUSA vault are marked `causaVaulted`; everything else feeds the home tape and pulse only.
- **Candidate marker:** stock paired (basket or an xStock quote), new coin / about to graduate / graduated, market cap, graduation progress; chain lane, tier 1.
- **Use:** Current chain-market snapshot and cross-check (`web/lib/stonkfun/client.ts`, `web/lib/stonkfun/live.ts`, `web/app/api/cron/stonkfun`). It is explicitly not evidence of the original external news catalyst.
- **No trade stream:** StonkFun publishes no WebSocket. Per-trade rows come from the `trades` collection only when something fills it, and are otherwise empty — never faked.

### 4.7 StonkFun catalogue lookup — duplicate check only

- **Requests:**

  ```text
  GET https://www.stonkfun.xyz/api/public/v1/tokens/{mint}
  GET https://www.stonkfun.xyz/api/public/v1/tokens?sort=marketCap&limit=100
  ```

- **Use:** Before a fresh card is sent, the proposed explicit identity is matched against the catalogue for an exact/similar existing name or ticker (StonkFun's site searches by name, symbol or mint; the public API exposes the catalogue rather than a search parameter).
- **Fallback:** If the lookup fails, DexScreener search is used.
- **Not used for:** Finding an outside-world thesis, automatically launching a token, or notifying a user about a coin.

## 5. Images and article enrichment

### Article image resolver

- **Request:** `GET {candidate.source_urls[0]}` with a normal User-Agent, reads up to 512 KB HTML.
- **Purpose:** Best-effort extraction of public Open Graph image for a Telegram card.
- **Failure behavior:** Fails closed to a text-only card. No alert is blocked because an image could not be fetched.
- **Safety:** It only runs for a selected public article URL. It does not use passwords/cookies.

## 6. OpenRouter: AI analysis, not a news source

OpenRouter is included because it receives source facts, but it is **not** an information source or a reason to alert.

- **Model configuration:** `OPENROUTER_MODEL=google/gemini-3.7-flash:batch`.
- **Authentication:** `Authorization: Bearer <OPENROUTER_TOKEN>` from the server secret file. The secret value is never stored in code, logs, or this document.
- **Endpoints:**

  ```text
  GET  https://openrouter.ai/api/v1/models
  POST https://openrouter.ai/api/v1/chat/completions        # non-batch only
  POST https://openrouter.ai/api/beta/batches               # configured batch path
  GET  https://openrouter.ai/api/beta/batches/{batch_id}
  ```

- **Batch request body shape:**

  ```json
  {
    "endpoint": "/v1/chat/completions",
    "model": "google/gemini-3.7-flash",
    "requests": [
      {
        "custom_id": "thesis-{stable-hash}",
        "body": {
          "model": "google/gemini-3.7-flash",
          "messages": [{"role": "user", "content": "candidate facts + source-network evidence"}],
          "temperature": 0.2,
          "max_tokens": 320,
          "response_format": {"type": "json_schema", "json_schema": "thesis_radar_review"}
        }
      }
    ]
  }
  ```

- **Facts supplied:** headline, source summary, source age, author, engagement, source count, Google-News source-network evidence, and duplicate-check result.
- **Structured response required:** English summary, meme thesis, why strong, virality/relevance 0–100, verification gap, risk, likely primary source, source assessment/action, stock pairing, and ticker concept.
- **Rule:** The deterministic freshness, provenance, duplicate, and market-linkage gates run **before** the batch is submitted. AI cannot override them. A successful AI response is a separate Telegram editorial follow-up.

## 7. Storage, audit, and source health

SQLite lives at `data/radar.db` inside the app data volume.

| Table | Contents | Why it exists |
|---|---|---|
| `source_runs` | source, lane, run start, latency, items, error | Availability/latency monitoring |
| `decisions` | candidate fingerprint, source names, age, score dimensions, gate stage/reason, observed time | Why a card was sent/rejected/audited |
| `sent`, `sent_urls` | candidate fingerprint and source URL | Prevent repeated Telegram cards |
| `observations`, `observed_signals`, `numeric_snapshots` | engagement and market baselines | Outlier/scoring support |
| `enrichment_queue` | high-signal topics waiting for deeper research | Controlled follow-up workflow |
| `ai_batches` | OpenRouter batch ID/status/result/error | Asynchronous AI delivery state |
| `source_registry.json` | explicitly discovered RSS/news endpoint candidates | Future source onboarding without monitoring token/project sites |

`python -m thesis_radar shadow-report --hours 24 --max-age-minutes 20` reports source health, source errors, decision distribution, stale alerts, top candidates, average detection lag, and fresh-under-20-minute count.

## 8. Configuration quick reference

| Variable | Default / intended value | Meaning |
|---|---|---|
| `SOURCE_GOOGLE_NEWS` | `1` | Google News RSS discovery and network evidence |
| `SOURCE_HACKERNEWS` | `1` | HN new stories |
| `SOURCE_YAHOO_FINANCE` | `1` | Public Yahoo Finance news stream |
| `SOURCE_STOCKTWITS` | `1` | Stocktwits symbol-linked news API |
| `SOURCE_BARCHART` | `1` | Barchart JSON news stream |
| `SOURCE_CULTURE_RSS` | `1` | Configured/default culture feeds |
| `SOURCE_NASDAQ_HALTS` | `1` | Nasdaq halts RSS |
| `SOURCE_GECKOTERMINAL` | `1` | New Solana pools |
| `SOURCE_POLYMARKET` | `1` | Large active-market probability moves |
| `SOURCE_ROBINHOOD` | `1` | Configured stock-token quotes/halts |
| `SOURCE_DEXSCREENER_ROBINHOOD_DISCOVERY` | `1` | Robinhood profile/boost discovery |
| `SOURCE_STONKFUN_CATALOGUE` (formerly `SOURCE_PUMP_CATALOGUE`) | deployment-specific | StonkFun stock-paired chain market snapshots |
| `SOURCE_DEXSCREENER_ROBINHOOD` | deployment-specific | Fixed-symbol Robinhood pair scan |
| `SOURCE_SEC_EDGAR` | `0` | Official filing feed; requires operator UA |
| `SOURCE_FOREXFACTORY` | `0` | Macro calendar; intentionally noisy |
| `SOURCE_NARRATIVE_RADAR` | `0` | Legacy backup only |
| `SOURCE_ROBINHOOD_BACKFILL` | `0` | Must remain off for live Telegram operation |
| `NOTIFY_ROBINHOOD_BACKFILL` | `0` | Safety belt: never notify historical backfills |
| `REQUIRE_ACTIONABLE_MARKET_LINK` | `1` | Reject non-market memes from Telegram |
| `REQUIRE_PRIMARY_SOURCE` | `1` | Reject chain/indexer-only candidates |
| `MAX_ALERT_MARKET_CAP_USD` | `1000000` | Reject late, already-large linked tokens |

## 9. Operational boundaries

- No non-X source in this inventory is authorised to launch, buy, sell, or trade a token or stock.
- No token/project website is promoted to a source merely because a backfill finds it.
- “First source” is measured only within the monitored sources and visible timestamps. Proving global first publication requires a source-specific first-party feed or API.
- If a recognised news site has no reliable public RSS/API endpoint, the correct action is to request an operator-provided HAR/API reference rather than scrape session-bound traffic.
