# ETL Pipeline

Python ETL orchestrator for the Info Aggregator. Fetches data from external APIs and upserts it into Supabase (`info_agg` schema).

All commands below assume you are in the **repo root** and the venv is active:

```bash
source _agg_venv/bin/activate
```

---

## Directory Structure

```
src/api/
├── run_etl.py               # Orchestrator — entry point for all ETL runs
├── requirements.txt         # Python dependencies
├── RATE_LIMITS.md           # Per-API rate limits and budget notes
│
├── markets/
│   ├── baskets.json         # Watchlist: 5 groups, 36 tickers (stocks, ETFs, crypto)
│   ├── alpha_vantage.py     # AV fetcher: news sentiment (daily); OHLCV candles + ETF holdings (seed only)
│   ├── finnhub.py           # Finnhub fetcher: quotes, crypto quotes, company/market news
│   ├── fmp.py               # FMP fetcher: ETF info, ETF holdings, company profiles, backfill
│   └── markets_db_helper.py # DB layer: upserts for all markets tables
│
├── sports/
│   ├── sports_fetcher.py    # ESPN fetcher: scores + news for all configured leagues
│   └── sports_db_helper.py  # DB layer: upserts for leagues, sports_news, sports_scores
│
├── news/
│   ├── nyt.py               # NYT Top Stories + Most Popular fetcher
│   └── news_db_helper.py    # DB layer: upserts for news_articles
│
└── media/
    ├── spotify.py           # Spotify new releases fetcher
    ├── reddit.py            # Reddit hot posts fetcher (unauthenticated)
    └── media_db_helper.py   # DB layer: upserts for spotify_releases, reddit_posts
```

---

## Setup

1. **Install dependencies**
   ```bash
   pip install -r src/api/requirements.txt
   ```

2. **Configure `.env.local`** in the repo root:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

   # Markets
   FINNHUB_API_KEY_1=<key>
   FINNHUB_API_KEY_2=<key>
   FMP_API_KEY=<key>
   ALPHA_VANTAGE_API_KEY=<key>
   ALPHA_VANTAGE_API_KEY_1=<key>   # optional second key for rotation
   ALPHA_VANTAGE_API_KEY_2=<key>   # optional third key

   # News (NYT)
   NYT_API_KEY_1=<key>
   NYT_API_KEY_2=<key>

   # Media
   SPOTIFY_CLIENT_ID=<id>
   SPOTIFY_CLIENT_SECRET=<secret>
   ```

3. **Apply DB migrations** (once, on a new environment):
   ```bash
   # Run in order via Supabase SQL editor or MCP
   supabase/01_schema.sql
   supabase/02_tables.sql
   supabase/03_rls.sql
   supabase/04_indexes.sql
   ```

---

## Watchlist — `baskets.json`

All market ETL is driven by `markets/baskets.json`. Five groups determine which fetcher and `asset_type` each ticker uses:

| Group | Asset Type | Tickers (count) | Daily Quote Source | Seed Backfill Source |
|-------|-----------|-----------------|-------------------|---------------------|
| `core_stocks` | `stock` | AAPL MSFT NVDA AMZN GOOGL META TSLA BRK.B JPM AVGO (10) | Finnhub `/quote` | AV `TIME_SERIES_DAILY` |
| `core_market` | `etf` | VTI SPY QQQ IWM VXUS (5) | Finnhub `/quote` | AV `TIME_SERIES_DAILY` |
| `sectors` | `etf` | XLC XLY XLP XLE XLF XLV XLI XLB XLRE XLK XLU (11) | Finnhub `/quote` | AV `TIME_SERIES_DAILY` |
| `breadth` | `etf` | RSP VUG VTV (3) | Finnhub `/quote` | AV `TIME_SERIES_DAILY` |
| `risk` | `etf` | TLT HYG GLD UUP (4) | Finnhub `/quote` | AV `TIME_SERIES_DAILY` |
| `crypto` | `crypto` | BTC ETH XRP (3) | Finnhub `/quote` (via `BINANCE:*USDT`) | AV `DIGITAL_CURRENCY_DAILY` |
| `forex` | `forex` | EURUSD GBPUSD USDJPY … (10) | FMP `/stable/quote` | — |
| `commodities` | `commodity` | BZUSD SIUSD GCUSD (3) | FMP `/stable/quote` | — |

To add or remove tickers, edit `baskets.json` — no code changes required.

---

## Running the ETL

See **[`RUNBOOK.md`](RUNBOOK.md)** for the full guide, including:
- Step-by-step initial seed instructions with per-phase timing
- What the daily run does per domain
- Budget guidance, decision tree, and Vercel Cron constraints

### Quick reference

```bash
# Initial seed (new environment) — dedicated seed orchestrator
python src/api/run_db_seed.py

# Daily run (all domains)
python src/api/run_etl.py

# Domain-specific daily runs
python src/api/run_etl.py --markets-only
python src/api/run_etl.py --news-only
python src/api/run_etl.py --sports-only
python src/api/run_etl.py --media-only
```

### Expected run times

| Command | Scope | Est. duration | Notes |
|---------|-------|---------------|-------|
| `run_db_seed.py` | All domains + backfill | ~12–18 min | 3 AV keys; scales with key count |
| `run_etl.py` | All domains, no backfill | ~5–7 min | Auto catch-up if >24h since last run |
| `run_etl.py --markets-only` | Quotes + news + sentiment | ~2–3 min | 36 Finnhub calls + 5 AV calls |
| `run_etl.py --sports-only` | ESPN news + scores | ~10–15s | ESPN calls spaced >=1s between requests |
| `run_etl.py --news-only` | NYT top stories | ~10–25s | 9 sections × ~1.1s minimum sleep between calls + 1 most-popular |
| `run_etl.py --media-only` | Spotify + Reddit | ~15–20s | 8 Reddit calls × 1s sleep |

> **Vercel Cron (Hobby plan, 60s limit):** A full daily run exceeds the limit. Partial
> completion is normal — Sports and Media finish comfortably; Markets and News may be cut
> short. See `RUNBOOK.md` for mitigation options.

### `run_etl.py` flags

| Flag | Effect |
|------|--------|
| `--sports-only` | Run sports ETL only |
| `--markets-only` | Run markets ETL only (quotes + news + sentiment) |
| `--news-only` | Run news ETL only |
| `--media-only` | Run media ETL only |
| `--skip-sports` | Skip sports ETL |
| `--skip-markets` | Skip markets ETL |
| `--skip-news` | Skip news ETL |
| `--skip-media` | Skip media ETL |
| `--skip-sentiment` | Skip AV news sentiment (saves 5 AV calls) |
| `--backfill-news DAYS` | Backfill N days of NYT articles via Archive API* |
| `--backfill-sports DAYS` | Backfill N days of ESPN scores |
| `--scrape-etf-info` | Scrape ETF info + top-15 holdings from etfdb.com (manual, not daily) |
| `--all-sentiment-topics` | Fetch all 10 AV sentiment topics (default: 5) |
| `--watchlist TICKER ...` | Override basket watchlist with a custom ticker list |
| `--test` | Dry-run: call every external API endpoint once and print a PASS/FAIL table (no DB writes) |
| `--output FILE` | Write results JSON to FILE |

### `run_db_seed.py` flags

| Flag | Default | Effect |
|------|---------|--------|
| `--backfill-quotes DAYS` | 30 | Days of OHLCV history to backfill via AV |
| `--backfill-news DAYS` | 30 | Days of NYT articles via Archive API* |
| `--backfill-sports DAYS` | 30 | Days of ESPN scores to backfill |
| `--output FILE` | — | Write results JSON to FILE |

*`--backfill-news` requires the Archive API product enabled at [developer.nytimes.com/my-apps](https://developer.nytimes.com/my-apps).

---

## Data Flow

```
baskets.json
    │
    ├─ core_stocks (stock) ──► Finnhub /quote ──────────────────► stock_quotes
    ├─ core_market (etf)   ──► Finnhub /quote ──────────────────► stock_quotes
    ├─ sectors (etf)       ──► Finnhub /quote ──────────────────► stock_quotes
    ├─ breadth (etf)       ──► Finnhub /quote ──────────────────► stock_quotes
    ├─ risk (etf)          ──► Finnhub /quote ──────────────────► stock_quotes
    ├─ crypto (crypto)     ──► Finnhub /quote (BINANCE:*USDT) ──► stock_quotes
    ├─ forex (forex)       ──► FMP /stable/quote ───────────────► stock_quotes
    └─ commodities         ──► FMP /stable/quote ───────────────► stock_quotes

    Profiles (manual / backfill):
    ├─ stocks  ──► Finnhub /stock/profile2 / FMP /stable/profile ► stocks
    └─ etfs    ──► AV ETF_PROFILE (seed) ──────────────────────► etf_holdings

    Seed backfill only (run_db_seed.py):
    ├─ stocks/etfs ──► AV TIME_SERIES_DAILY ─────────────────────► stock_quotes (bulk)
    └─ crypto      ──► AV DIGITAL_CURRENCY_DAILY ────────────────► stock_quotes (bulk)

Finnhub /company-news ───────────────────────────────────────────► company_news
Finnhub /news (general/forex/crypto/merger) ─────────────────────► market_news
AV NEWS_SENTIMENT (5–10 topics) ─────────────────────────────────► news_sentiment
FMP /stable/treasury-rates ──────────────────────────────────────► economic_indicators
FMP /stable/economic-indicators (7 names) ───────────────────────► economic_indicators

ESPN /news, /scoreboard ─────────────────────────────────────────► sports_news, sports_scores

NYT /topstories, /mostpopular ───────────────────────────────────► news_articles

Spotify /browse/new-releases ────────────────────────────────────► spotify_releases
Reddit /r/{sub}/hot ─────────────────────────────────────────────► reddit_posts
```

---

## Rate Limits Summary

See [`RATE_LIMITS.md`](RATE_LIMITS.md) for full details. Quick reference:

| API | Window | Limit | Strategy |
|-----|--------|-------|----------|
| Finnhub | 60 s | 60 req | Sliding-window deque — burst then sleep |
| Alpha Vantage | 60 s / key | 5 req | Sliding-window deque per key — burst then sleep |
| FMP | 1 day | 250 req | Daily counter; warns at 220, raises at 250 |
| NYT | 60 s | 5 req/key | Daily run switches keys after 5 calls (10 calls/day total) and enforces >=1s between NYT HTTP calls |
| Reddit | 60 s | 60 req | 1 s sleep between subreddit calls |
| Spotify | — | ~30/s | No explicit limiting needed at current volume |
| ESPN | — | Unknown | No limiting applied (unofficial API, low call count) |
