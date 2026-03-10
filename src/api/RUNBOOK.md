# ETL Runbook

Two distinct operating modes: **Initial Seed** (run once per environment) and **Daily Run** (run every day).

Both modes use the same entry point:

```bash
source _agg_venv/bin/activate   # from repo root
python src/api/run_etl.py [flags]
```

---

## Initial Seed

Run once when setting up a new environment. Goal: populate all tables with historical data so the frontend has something to display from day one.

### Step 1 — Markets: profiles + quote history backfill

```bash
python src/api/run_etl.py --markets-only --backfill-quotes 90
```

Per ticker (all 36 from `baskets.json`):

| Action | Source | Table |
|--------|--------|-------|
| Create `stocks` row with `asset_type` | — | `stocks` |
| Fetch company profile | Finnhub `/stock/profile2` | `stocks` |
| Fetch ETF info (if no Finnhub profile) | FMP `/stable/etf/information` | `stocks` |
| Enrich stock profile (sector, CEO, beta, etc.) | FMP `/api/v3/profile` | `stocks` |
| Backfill 90 days of daily OHLCV | AV `TIME_SERIES_DAILY` (stocks/ETFs) | `stock_quotes` |
| Backfill 90 days of daily OHLCV | AV `DIGITAL_CURRENCY_DAILY` (crypto) | `stock_quotes` |
| Fetch ETF holdings | FMP `/stable/etf/holdings` | `etf_holdings` |
| Fetch market news (general/forex/crypto/merger) | Finnhub `/news` | `market_news` |
| Fetch AV news sentiment (5 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |

Company news is **skipped** during backfill to preserve API budget (only the latest 7-day window would be fetched anyway — not useful for historical seeding).

**AV budget note:** 36 tickers × 1 call = 36 AV calls for backfill. With 2 keys at 25 req/day each, this takes 2 days. Run the backfill across 2 days or reduce `--backfill-quotes` if budget is tight.

---

### Step 2 — Sports: seed scores + news

```bash
python src/api/run_etl.py --sports-only
```

| Action | Source | Table |
|--------|--------|-------|
| Fetch scores (all active leagues) | ESPN `/scoreboard` | `sports_scores` |
| Fetch news (all active leagues) | ESPN `/news` | `sports_news` |

Leagues seeded by `01_schema.sql` / `02_tables.sql`: NFL, NBA, NHL, MLB, EPL, WNBA, college football/basketball.

---

### Step 3 — News: seed articles

```bash
python src/api/run_etl.py --news-only
```

| Action | Source | Table |
|--------|--------|-------|
| Fetch top stories (10 sections) | NYT `/topstories/v2/{section}` | `news_articles` |
| Fetch most popular | NYT `/mostpopular/v2/viewed/1` | `news_articles` |

---

### Step 4 — Media: seed releases + posts

```bash
python src/api/run_etl.py --media-only
```

| Action | Source | Table |
|--------|--------|-------|
| Fetch new album releases | Spotify `/v1/browse/new-releases` | `spotify_releases` |
| Fetch hot posts (8 subreddits) | Reddit `/r/{sub}/hot.json` | `reddit_posts` |

---

### Full seed in one shot (if AV budget allows)

```bash
python src/api/run_etl.py --backfill-quotes 90
```

Runs all four domains in sequence with backfill enabled. Only viable with enough AV daily budget (36+ calls).

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
