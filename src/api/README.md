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
├── run_etl.py               # Orchestrator — daily entry point; 5 fetch domains in parallel, then summary
├── run_quick_refresh.py     # Tiered intraday refresh (Tier A every 15 min, Tier B hourly) — no backfill
├── run_test.py               # Dry-run: calls every external API once, no DB writes
├── backfill_scores.py        # Standalone recovery tool for historical ESPN scores
├── docs/
│   ├── RATE_LIMITS.md        # Per-API rate limits and budget notes
│   ├── RUNBOOK.md            # Daily-run guide, budget/decision tree
│   ├── EXECUTION_ORDER.md    # What runs in what order, within and across domains
│   └── DEDUPLICATION.md      # Upsert conflict keys per table
│
├── markets/
│   ├── baskets.json         # Watchlist: 5 groups, 36 tickers (stocks, ETFs, crypto)
│   ├── alpha_vantage.py     # AV fetcher: news sentiment (daily); OHLCV candles + ETF holdings (backfill only)
│   ├── finnhub.py           # Finnhub fetcher: quotes, crypto quotes, company/market news
│   ├── fmp.py               # FMP fetcher: ETF info, ETF holdings, company profiles, backfill
│   ├── etfdb.py              # ETF info + top-holdings scraper (etfdb.com, manual trigger only)
│   └── markets_db_helper.py # DB layer: upserts for all markets tables
│
├── sports/
│   ├── espn.py              # ESPN fetcher: scores, news, and standings for all configured leagues
│   ├── odds.py                # Betting odds fetcher (not wired into run_etl.py)
│   └── sports_db_helper.py  # DB layer: upserts for leagues, sports_news, sports_scores, sports_standings
│
├── summary/
│   ├── gemini.py             # Gemini REST client: structured JSON out, model fallback, 12s cap
│   └── summary_db_helper.py  # Builds the grounding context, generates + stores both briefings
│
├── news/
│   ├── nyt.py               # NYT Top Stories + Most Popular fetcher
│   └── news_db_helper.py    # DB layer: upserts for news_articles
│
├── media/
│   ├── youtube.py           # YouTube trending-videos fetcher
│   └── media_db_helper.py   # DB layer: upserts for youtube_videos
│
├── misc/                     # Working fetchers not wired into run_etl.py (countries, facts,
│                              # holidays, weather, wikipedia, words)
│
└── archive/                   # Retired: run_db_seed.py (broken — see below), seed.py, av_seed.py,
                                # old per-domain schema docs
```

Spotify (playlists, Top Podcasts) is live-embedded on the frontend (`lib/top-podcasts.ts`) —
no fetcher or table. Reddit was removed.

Python dependencies live in **`requirements.txt` at the repo root** (same level as `src/`).

---

## Setup

1. **Install dependencies**
   ```bash
   pip install -r requirements.txt
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
   YOUTUBE_API_KEY=<key>
   ```

3. **Apply DB migrations** (once, on a new environment):
   ```bash
   # Run in order via Supabase SQL editor or MCP
   supabase/01_schema.sql
   supabase/02_tables.sql
   supabase/03_rls.sql
   supabase/04_indexes.sql
   supabase/05_prune.sql
   supabase/06_user_prefs.sql
   supabase/07_grants.sql
   supabase/08_watchlist_podcasts.sql
   ```

---

## Watchlist — `baskets.json`

All market ETL is driven by `markets/baskets.json`. Five groups determine which fetcher and `asset_type` each ticker uses:

| Group | Asset Type | Tickers (count) | Daily Quote Source | Seed Backfill Source |
|-------|-----------|-----------------|-------------------|---------------------|
| `core_stocks` | `stock` | AAPL MSFT NVDA AMZN GOOGL META TSLA BRK-B JPM AVGO (10) | Finnhub `/quote` | AV `TIME_SERIES_DAILY` |
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

See **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)** for the full guide: what the daily run does per
domain, and budget/decision-tree guidance.

> **No working initial-seed path right now.** `run_db_seed.py` — the old dedicated seed
> orchestrator with interleaved AV backfill — was moved to `archive/` and is currently broken
> (it calls `run_sports_etl()`/`run_news_etl()` with a `backfill_days` kwarg those functions no
> longer accept). `docs/RUNBOOK.md`'s "Initial Seed" section documents its old design for
> historical reference only, not as a runnable command. `backfill_scores.py` (below) is the one
> backfill path that still works, and covers ESPN score history.

### Quick reference

```bash
# Daily run (all domains, in parallel)
python src/api/run_etl.py

# Domain-specific daily runs
python src/api/run_etl.py --markets-only
python src/api/run_etl.py --news-only
python src/api/run_etl.py --sports-only
python src/api/run_etl.py --media-only

# What the scheduled GitHub Actions workflow actually runs
python src/api/run_etl.py --triggered-by cron --cleanup --season-schedules

# Tiered intraday refresh — no backfill, budget-aware
python src/api/run_quick_refresh.py --tier a   # every 15 min
python src/api/run_quick_refresh.py --tier b   # hourly

# Historical ESPN score backfill/recovery — safe to re-run, upserts by event
python src/api/backfill_scores.py --season current
```

### Expected run times

| Command | Scope | Est. duration | Notes |
|---------|-------|---------------|-------|
| `run_etl.py` | All domains, in parallel | well under 60s (target; see root `CLAUDE.md`) | Cooperative wall-clock budget, default 50s |
| `run_etl.py --markets-only` | Quotes + news + sentiment | ~2–3 min | 36 Finnhub calls + AV sentiment |
| `run_etl.py --sports-only` | ESPN news + scores | ~10–15s | ESPN calls spaced >=1s between requests |
| `run_etl.py --news-only` | NYT top stories | ~10–25s | 9 sections × ~1.1s minimum sleep between calls + 1 most-popular |
| `run_etl.py --media-only` | YouTube | ~1–2s | 1 call, 1 quota unit |

> **Scheduling:** the daily run is triggered by `.github/workflows/daily-etl.yml`
> (`cron: '43 10 * * *'` UTC, plus manual `workflow_dispatch` from the `/dashboard` admin
> button via `POST /api/etl`). It is not run on Vercel Cron — Vercel serverless has no Python
> runtime, and the old `/api/cron/etl` route referenced by older docs no longer exists.

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
| `--skip-sentiment` | Skip AV news sentiment |
| `--scrape-etf-info` | Scrape ETF info + top-15 holdings from etfdb.com (manual, not daily) |
| `--watchlist TICKER ...` | Override basket watchlist with a custom ticker list |
| `--test` | Dry-run: call every external API endpoint once and print a PASS/FAIL table (no DB writes) |
| `--output FILE` | Write results JSON to FILE |
| `--triggered-by {manual,cron,dispatch}` | Recorded in `etl_runs` (default `manual`; the GitHub Actions workflow passes `cron`) |
| `--budget-seconds N` | Cooperative wall-clock budget for the domain phase (default `50.0`) |
| `--cleanup` | Run `info_agg.cleanup_daily()` retention after the ETL completes |
| `--season-schedules` | Also fetch full season schedules for in-season leagues (daily run only) |

Sentiment is always all 10 AV topics when not skipped — there's no partial-topic flag.
`--backfill-news`/`--backfill-sports`/`--economic-indicators-only` were `run_db_seed.py`-only
flags; they don't exist on `run_etl.py`.

### `run_db_seed.py` flags (archived, currently broken — reference only)

| Flag | Default | Effect |
|------|---------|--------|
| `--backfill-quotes DAYS` | 30 | Days of OHLCV history to backfill via AV |
| `--backfill-news DAYS` | 30 | Days of NYT articles via Archive API* |
| `--backfill-sports DAYS` | 30 | Days of ESPN scores to backfill |
| `--output FILE` | — | Write results JSON to FILE |

*`--backfill-news` requires the Archive API product enabled at [developer.nytimes.com/my-apps](https://developer.nytimes.com/my-apps).

### `run_quick_refresh.py` flags

| Flag | Default | Effect |
|------|---------|--------|
| `--tier {a,b}` | `a` | Tier A (every 15 min): Finnhub quotes + ESPN scoreboards + Finnhub market news, no daily API budget spent. Tier B (hourly): tier A + NYT top stories + ESPN news + FMP forex/commodity quotes |
| `--triggered-by` | `manual` | Recorded in `etl_runs` |

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

    Seed backfill only (run_db_seed.py — archived, currently broken):
    ├─ stocks/etfs ──► AV TIME_SERIES_DAILY ─────────────────────► stock_quotes (bulk)
    └─ crypto      ──► AV DIGITAL_CURRENCY_DAILY ────────────────► stock_quotes (bulk)

Finnhub /company-news ───────────────────────────────────────────► company_news
Finnhub /news (general/forex/crypto/merger) ─────────────────────► market_news
AV NEWS_SENTIMENT (10 topics) ────────────────────────────────────► news_sentiment
FMP /stable/treasury-rates ──────────────────────────────────────► economic_indicators
FMP /stable/economic-indicators (7 names) ───────────────────────► economic_indicators

ESPN /news, /scoreboard, /standings ──────────────────────────────► sports_news, sports_scores, sports_standings

NYT /topstories, /mostpopular ───────────────────────────────────► news_articles

YouTube /videos?chart=mostPopular ────────────────────────────────► youtube_videos
```

Spotify (playlists, Top Podcasts) is embedded directly on the frontend via `<iframe>` — no
fetch, no table, not part of this pipeline.

---

## Rate Limits Summary

See [`docs/RATE_LIMITS.md`](docs/RATE_LIMITS.md) for full details. Quick reference:

| API | Window | Limit | Strategy |
|-----|--------|-------|----------|
| Finnhub | 60 s | 60 req | Sliding-window deque — burst then sleep |
| Alpha Vantage | 60 s / key | 5 req | `MinInterval` slot reservation, 1.25s min gap between calls |
| FMP | 1 day | 250 req | Daily counter; warns at 220, raises at 250 |
| NYT | 60 s | 5 req/key | Daily run switches keys after 5 calls (10 calls/day total) and enforces >=1s between NYT HTTP calls |
| YouTube | 1 day | 10,000 units | 1 call/run, 1 unit cost — no limiting needed |
| ESPN | — | Unknown | No limiting applied (unofficial API, low call count) |

All of the above also sit behind a shared circuit breaker (`etl_lib.EndpointBreaker`) that trips
an endpoint after 3 consecutive failures — see `docs/RATE_LIMITS.md` for details.
