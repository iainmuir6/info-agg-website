# ETL Runbook

Two distinct operating modes: **Initial Seed** (run once per environment) and **Daily Run** (run every day).

Both modes use the same entry point:

```bash
source _agg_venv/bin/activate   # from repo root
python src/api/run_etl.py [flags]
```

---

## Initial Seed

Run once when setting up a new environment. One command does everything:

```bash
python src/api/run_etl.py --seed
```

This expands to `--backfill-quotes 30 --backfill-news 30 --backfill-sports 30` and runs all four domains in sequence.

### What `--seed` does per domain

#### Markets (Finnhub + FMP + AV)

Per ticker (all 36 from `baskets.json`):

| Action | Source | Table |
|--------|--------|-------|
| Create `stocks` row with `asset_type` | — | `stocks` |
| Fetch company profile | Finnhub `/stock/profile2` | `stocks` |
| Fetch ETF info (if no Finnhub profile) | FMP `/stable/etf/information` | `stocks` |
| Enrich stock profile (sector, CEO, beta, etc.) | FMP `/api/v3/profile` | `stocks` |
| Backfill 30 days of daily OHLCV | AV `TIME_SERIES_DAILY` (stocks/ETFs) | `stock_quotes` |
| Backfill 30 days of daily OHLCV | AV `DIGITAL_CURRENCY_DAILY` (crypto) | `stock_quotes` |
| Fetch ETF holdings | FMP `/stable/etf/holdings` | `etf_holdings` |
| Fetch market news (general/forex/crypto/merger) | Finnhub `/news` | `market_news` |
| Fetch AV news sentiment (5 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |

Company news is **skipped** during backfill to preserve API budget.

> **AV budget note:** 36 tickers × 1 call = 36 AV calls for the quote backfill. With 2 keys at 25 req/day each (50 total), all 36 tickers fit in a single run with headroom to spare.

#### Sports

| Action | Source | Table |
|--------|--------|-------|
| Backfill 30 days of scores for all leagues | ESPN `/scoreboard?dates=YYYYMMDD` | `sports_scores` |
| Fetch current news for all leagues | ESPN `/news` | `sports_news` |

Leagues seeded by `01_schema.sql` / `02_tables.sql`: NFL, NBA, NHL, MLB, EPL, WNBA, college football/basketball.

#### News

| Action | Source | Table |
|--------|--------|-------|
| Backfill 30 days via Archive API* | NYT `/archive/v1/{year}/{month}.json` | `news_articles` |
| Fetch current top stories (10 sections) | NYT `/topstories/v2/{section}` | `news_articles` |
| Fetch most popular (7-day viewed) | NYT `/mostpopular/v2/viewed/7` | `news_articles` |

Archive results are filtered to the 10 configured sections, articles since the cutoff date, and capped at **5 articles per section per day** (approximates "most popular" since the Archive API has no popularity signal).

> **Archive API prerequisite:** The "Archive API" product must be enabled at [developer.nytimes.com/my-apps](https://developer.nytimes.com/my-apps) for your `NYT_API_KEY`. The default key (Top Stories + Most Popular) returns 401 on the archive endpoint. If not enabled, `--backfill-news` is silently skipped and only current top stories are fetched.

#### Media

| Action | Source | Table |
|--------|--------|-------|
| Fetch new album releases | Spotify `/v1/browse/new-releases` | `spotify_releases` |
| Fetch hot posts (8 subreddits) | Reddit `/r/{sub}/hot.json` | `reddit_posts` |

No historical backfill available for media sources.

---

### Seed with custom backfill depth

```bash
# Deeper history (uses more AV budget)
python src/api/run_etl.py --seed --backfill-quotes 180

# Shallow seed (AV budget-constrained)
python src/api/run_etl.py --seed --backfill-quotes 30

# Seed individual domains independently
python src/api/run_etl.py --markets-only --backfill-quotes 30
python src/api/run_etl.py --news-only    --backfill-news 30
python src/api/run_etl.py --sports-only  --backfill-sports 30
python src/api/run_etl.py --media-only
```

---

## Daily Run

Run once per day to keep all data fresh. FMP is included inside the markets step — there is no separate FMP flag.

### Standard daily run

```bash
python src/api/run_etl.py
```

Runs all four domains sequentially: **markets → sports → news → media**.

### What each domain does on a daily run

#### Markets (Finnhub + FMP + AV)

Per ticker (all 36):

| Action | Source | Table |
|--------|--------|-------|
| Fetch latest quote | Finnhub `/quote` (stocks/ETFs) | `stock_quotes` |
| Fetch latest quote | Finnhub `/crypto/candle` (BTC/ETH/XRP) | `stock_quotes` |
| Fetch company news (7-day window) | Finnhub `/company-news` | `company_news` |
| Update company/ETF profile | Finnhub `/stock/profile2` → FMP fallback | `stocks` |
| Update ETF info + holdings | FMP `/stable/etf/information`, `/etf/holdings` | `stocks`, `etf_holdings` |

Then once (not per-ticker):

| Action | Source | Table |
|--------|--------|-------|
| Fetch market news (4 categories) | Finnhub `/news` | `market_news` |
| Fetch AV sentiment (5 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |

#### Sports

Same as seed — scores and news are always the latest snapshot. All prior rows are upserted (no duplication on re-run).

#### News

Same as seed — fetches current top stories for all 10 NYT sections.

#### Media

Same as seed — fetches current new releases and hot posts.

---

### Daily run variants

```bash
# Save FMP budget — only update ETF info/holdings, skip stock profile re-sync
python src/api/run_etl.py --fmp-etf-only

# Skip slow domains when iterating on markets
python src/api/run_etl.py --markets-only

# Expanded AV sentiment (all 10 topics, ~2× AV budget)
python src/api/run_etl.py --all-sentiment-topics

# Catch up after a missed day (short backfill, no profile re-fetch overhead)
python src/api/run_etl.py --markets-only --backfill-quotes 3
```

---

## Decision Tree

```
New environment?
  └─ YES → Run Initial Seed (Steps 1–4 above)
  └─ NO  → Daily Run

Daily Run — budget constraints?
  ├─ FMP budget tight    → add --fmp-etf-only
  ├─ AV budget tight     → omit --all-sentiment-topics (default 5 topics)
  └─ Missed a day        → add --backfill-quotes 3 to --markets-only run
```

---

## Key Differences: Seed vs. Daily

| Behaviour | Seed | Daily |
|-----------|------|-------|
| Quote history depth | 90 days (or N via `--backfill-quotes`) | 1 day (latest quote only) |
| Company news | Skipped | Fetched (7-day window) |
| FMP ETF holdings | Full upsert | Full upsert |
| AV sentiment | 5 topics | 5 topics (10 with `--all-sentiment-topics`) |
| AV calls per run | ~36 (backfill) + 5 (sentiment) ≈ 41 | 5 (sentiment only) |
| Typical duration | ~15–20 min | ~3–5 min |
