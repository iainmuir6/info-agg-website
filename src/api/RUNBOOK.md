# ETL Runbook

Two distinct operating modes: **Initial Seed** (run once per environment) and **Daily Run** (automated, self-healing).

---

## Initial Seed

Run once when setting up a new environment:

```bash
source _agg_venv/bin/activate   # from repo root
python src/api/run_db_seed.py
```

Custom backfill depth:

```bash
python src/api/run_db_seed.py --backfill-quotes 90 --backfill-news 30 --backfill-sports 30
```

### What `run_db_seed.py` does

`run_db_seed.py` is a dedicated seed orchestrator that **interleaves** Alpha Vantage backfill
batches with other domain ETL. This ensures the AV 5 req/min rate-limit window resets
naturally during domain work (ESPN, NYT, Spotify) instead of burning a `sleep()` call.

#### Phase layout (36-ticker basket)

| Phase | Action | ~Time elapsed since last AV batch |
|-------|--------|-----------------------------------|
| 1 | AV backfill — tickers 1–10 | — (first batch) |
| 2 | FMP — company profiles + ETF holdings | — |
| 3 | Sports — ESPN backfill + current news | >60s → AV window reset ✓ |
| 4 | AV backfill — tickers 11–20 | — |
| 5 | News — NYT Archive backfill | >60s → AV window reset ✓ |
| 6 | AV backfill — tickers 21–30 | — |
| 7 | Media — Spotify + Reddit | >60s → AV window reset ✓ |
| 8 | AV backfill — remaining tickers + sentiment (all 10 topics) | — |
| 9 | Finnhub — market news + company news | — |

#### AV budget (2 keys × 25 req/day = 50 total)

36 ticker backfills + 10 sentiment topics = 46 calls → ~23/key. Round-robin key
selection distributes load evenly so neither key exhausts its daily cap mid-run.

#### Per-domain detail

**Markets (AV + FMP + Finnhub)**

| Action | Source | Table |
|--------|--------|-------|
| Company profiles + ETF info | FMP `/stable/profile`, `/stable/etf/information` | `stocks` |
| ETF holdings | FMP `/stable/etf/holdings` | `etf_holdings` |
| Backfill N days of daily OHLCV (stocks/ETFs) | AV `TIME_SERIES_DAILY` | `stock_quotes` |
| Backfill N days of daily OHLCV (crypto) | AV `DIGITAL_CURRENCY_DAILY` | `stock_quotes` |
| Market news (general/forex/crypto/merger) | Finnhub `/news` | `market_news` |
| Company news (7-day window) | Finnhub `/company-news` | `company_news` |
| AV news sentiment (all 10 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |

Company news is **skipped** during the AV backfill phases to preserve budget; it is fetched in Phase 9.

**Sports**

| Action | Source | Table |
|--------|--------|-------|
| Backfill N days of scores for all leagues | ESPN `/scoreboard?dates=YYYYMMDD` | `sports_scores` |
| Fetch current news for all leagues | ESPN `/news` | `sports_news` |

Leagues seeded by `01_schema.sql` / `02_tables.sql`: NFL, NBA, NHL, MLB, EPL, WNBA, college football/basketball.

**News**

| Action | Source | Table |
|--------|--------|-------|
| Backfill N days via Archive API* | NYT `/archive/v1/{year}/{month}.json` | `news_articles` |
| Fetch current top stories (10 sections) | NYT `/topstories/v2/{section}` | `news_articles` |

Archive results are filtered to the 10 configured sections, articles since the cutoff date,
and capped at **5 articles per section per day**.

> **Archive API prerequisite:** The "Archive API" product must be enabled at
> [developer.nytimes.com/my-apps](https://developer.nytimes.com/my-apps) for your
> `NYT_API_KEY`. If not enabled, `--backfill-news` is silently skipped and only
> current top stories are fetched.

**Media**

| Action | Source | Table |
|--------|--------|-------|
| Fetch new album releases | Spotify `/v1/browse/new-releases` | `spotify_releases` |
| Fetch hot posts (8 subreddits) | Reddit `/r/{sub}/hot.json` | `reddit_posts` |

No historical backfill available for media sources.

---

## Daily Run

```bash
source _agg_venv/bin/activate   # from repo root
python src/api/run_etl.py
```

Runs all four domains sequentially: **sports → markets → news → media**.

### Auto catch-up

At startup, `run_etl.py` queries `MAX(fetched_at)` from `info_agg.stock_quotes`. If the
last run was more than 24 hours ago it automatically backfills the gap (capped at 7 days):

```
Auto catch-up: last run was 2 day(s) ago — backfilling 2 days
```

This covers missed cron runs without any manual intervention. Passing `--backfill-quotes N`
explicitly takes precedence and disables auto catch-up.

### What each domain does on a daily run

#### Markets (Finnhub + AV)

Per ticker (all 36):

| Action | Source | Table |
|--------|--------|-------|
| Fetch latest quote | Finnhub `/quote` (stocks/ETFs) | `stock_quotes` |
| Fetch latest quote | Finnhub `/crypto/candle` (BTC/ETH/XRP) | `stock_quotes` |
| Fetch company news (7-day window) | Finnhub `/company-news` | `company_news` |

Then once (not per-ticker):

| Action | Source | Table |
|--------|--------|-------|
| Fetch market news (4 categories) | Finnhub `/news` | `market_news` |
| Fetch AV sentiment (5 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |

Profile/info updates are **not** run daily — trigger manually with `--scrape-etf-info` (ETFdb).

#### Sports / News / Media

Same as seed — always fetches the current snapshot (scores, news, releases, posts).

---

### Daily run variants

```bash
# Skip slow domains when iterating on markets
python src/api/run_etl.py --markets-only

# Expanded AV sentiment (all 10 topics, ~2× AV budget)
python src/api/run_etl.py --all-sentiment-topics

# Manual catch-up override (disables auto catch-up)
python src/api/run_etl.py --backfill-quotes 3

# Scrape ETF info + holdings from etfdb.com (manual trigger)
python src/api/run_etl.py --scrape-etf-info
```

> **Note:** `--fmp-etf-only` is documented in older runbook versions but is **not
> implemented** as a CLI flag in `run_etl.py`. Use `--scrape-etf-info` for ETFdb,
> or call `run_fmp_etl(supabase, etf_only=True)` directly from Python.

---

## Decision Tree

```
New environment?
  └─ YES → python src/api/run_db_seed.py
  └─ NO  → python src/api/run_etl.py  (auto catch-up handles missed days)

Daily Run — budget constraints?
  ├─ AV budget tight      → omit --all-sentiment-topics (default 5 topics)
  └─ Need manual catch-up → --backfill-quotes N  (overrides auto catch-up)
```

---

## Key Differences: Seed vs. Daily

| Behaviour | Seed (`run_db_seed.py`) | Daily (`run_etl.py`) |
|-----------|------------------------|----------------------|
| Entry point | `run_db_seed.py` | `run_etl.py` |
| Quote history depth | N days (default 30) via `--backfill-quotes` | 1 day, or auto catch-up ≤7d |
| AV key selection | Round-robin per ticker | Round-robin per call |
| AV rate limiting | Interleaved with domain ETL (no explicit sleep) | Per-key sliding-window deque |
| Company news | Skipped during backfill; fetched in Phase 9 | Fetched (7-day window) |
| FMP ETF holdings | Full upsert (Phase 2) | Not run (manual only) |
| AV sentiment | All 10 topics (Phase 8) | 5 topics (10 with `--all-sentiment-topics`) |
| AV calls per run | ~36 (backfill) + 10 (sentiment) = 46 | 5–10 (sentiment only) |
| Typical duration | ~20–30 min | ~3–5 min |
