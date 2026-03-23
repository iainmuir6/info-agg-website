# ETL Runbook

Two distinct operating modes: **Initial Seed** (run once per environment) and **Daily Run** (automated via Vercel Cron or manual trigger).

---

## Initial Seed

Run once when setting up a new environment:

```bash
source _agg_venv/bin/activate   # from repo root
python src/api/run_db_seed.py
```

Custom backfill depth (defaults: 30 days each):

```bash
python src/api/run_db_seed.py --backfill-quotes 90 --backfill-news 30 --backfill-sports 30
```

### What `run_db_seed.py` does

`run_db_seed.py` is a dedicated seed orchestrator that **interleaves** Alpha Vantage backfill
batches with other domain ETL. This ensures the AV 5 req/min window resets naturally during
domain work (ESPN, NYT, Spotify) rather than burning a `sleep()` call.

#### Phase layout (36-ticker basket)

| Phase | Action | ~Time elapsed since last AV batch |
|-------|--------|-----------------------------------|
| 0 | AV key inventory — report key count + daily budget | — |
| 1 | AV backfill — tickers 1–10 | — (first batch) |
| 2 | FMP — company profiles + ETF info; AV ETF_PROFILE — ETF holdings | — |
| 3 | Sports — ESPN backfill + current news | >60s → AV window reset ✓ |
| 4 | AV backfill — tickers 11–20 | — |
| 5 | News — NYT Archive backfill | >60s → AV window reset ✓ |
| 6 | AV backfill — tickers 21–30 | — |
| 7 | Media — Spotify + Reddit | >60s → AV window reset ✓ |
| 8 | AV backfill — remaining tickers + sentiment (all 10 topics) | — |
| 9 | Finnhub — market news + company news (all 36 tickers) | — |
| 10 | FMP — economic indicators full history (treasury rates + 7 macro, ~8 calls) | — |

#### AV budget

Budget depends on how many `ALPHA_VANTAGE_API_KEY_*` variables are set in `.env.local`.
With 3 keys configured (the default):

| Item | Calls |
|------|-------|
| Quote backfill — 36 tickers | 36 |
| ETF holdings (`ETF_PROFILE`) — 23 ETFs | 23 |
| Sentiment — all 10 topics | 10 |
| **Seed total** | **69** |
| Daily budget (3 keys × 25 req/day) | 75 |
| **Headroom** | **+6** |

Round-robin key selection distributes calls evenly across all configured keys so no single
key exhausts its daily cap mid-run. Phase 0 prints a live budget breakdown before any calls.

#### Expected run time — Seed

| Phase | Dominant work | Est. duration |
|-------|---------------|---------------|
| 0 | Key inventory report | <1s |
| 1 | 10 AV calls (3-key round-robin → 15 req/min) | ~1–2 min |
| 2 | FMP: 33 profiles (~30s); AV ETF_PROFILE: 23 calls (~1.5 min) | ~2 min |
| 3 | ESPN: 30d × ~10 leagues + news | ~1–2 min |
| 4 | 10 AV calls (window reset by Phase 3) | ~1 min |
| 5 | NYT Archive (1–2 months) + Top Stories (9 sections; >=1s between calls) | ~2 min |
| 6 | 10 AV calls (window reset by Phase 5) | ~1 min |
| 7 | Spotify + Reddit (8 subs × 1s sleep) | ~15–20s |
| 8 | 6 AV ticker calls + 10 sentiment calls | ~1 min |
| 9 | Finnhub company news (36 tickers) + market news | ~1–2 min |
| 10 | FMP treasury rates + 7 macro indicators (~8 calls) | ~10–15s |
| **Total** | | **~12–18 min** |

> Timing scales with key count and network latency. With 1 AV key (5 req/min) the seed
> takes ~25–35 min; with 3 keys (~15 req/min effective) it completes in ~12–18 min.

#### Per-domain detail

**Markets (AV + FMP + Finnhub)**

| Action | Source | Table |
|--------|--------|-------|
| Company profiles + ETF info | FMP `/stable/profile` | `stocks` |
| ETF holdings | AV `ETF_PROFILE` | `etf_holdings` |
| Backfill N days of daily OHLCV (stocks/ETFs) | AV `TIME_SERIES_DAILY` | `stock_quotes` |
| Backfill N days of daily OHLCV (crypto) | AV `DIGITAL_CURRENCY_DAILY` | `stock_quotes` |
| Market news (general/forex/crypto/merger) | Finnhub `/news` | `market_news` |
| Company news (7-day window, all 36 tickers) | Finnhub `/company-news` | `company_news` |
| AV news sentiment (all 10 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |
| Economic indicators — full history (treasury rates + 7 macro) | FMP `/stable/treasury-rates`, `/stable/economic-indicators` | `economic_indicators` |

Company news is fetched **only in Phase 9** (not during AV backfill phases) to keep AV
budget usage predictable.

**Sports**

| Action | Source | Table |
|--------|--------|-------|
| Backfill N days of scores for all leagues | ESPN `/scoreboard?dates=YYYYMMDD` | `sports_scores` |
| Fetch current news for all leagues | ESPN `/news` | `sports_news` |

Leagues: NFL, NBA, NHL, MLB, EPL, WNBA, college football/basketball.

**News**

| Action | Source | Table |
|--------|--------|-------|
| Backfill N days via Archive API* | NYT `/archive/v1/{year}/{month}.json` | `news_articles` |
| Fetch current top stories (9 sections) + most-popular (1 call) | NYT `/topstories/v2/{section}` + `/mostpopular/v2/viewed/{period}` | `news_articles` |

Archive results are filtered to the 10 configured sections, articles since the cutoff date,
and capped at **5 articles per section per day**.

> **Archive API prerequisite:** The "Archive API" product must be enabled at
> [developer.nytimes.com/my-apps](https://developer.nytimes.com/my-apps) for your
> `NYT_API_KEY_1` (default key for Archive backfill). If not enabled, `--backfill-news` is silently skipped and only
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

### Expected run time — Daily Run (no backfill)

| Domain | Work performed | Est. duration |
|--------|---------------|---------------|
| Sports | ESPN: news + scores for ~10 leagues | ~10–15s |
| Markets | Finnhub: 36 quotes + 36 company-news + 4 market-news; AV: 5 sentiment topics | ~90–120s |
| News | NYT Top Stories: 9 sections × >=1s pacing + 1 most-popular call | ~90–120s |
| Media | Spotify (1–2 calls) + Reddit (8 subs × 1s sleep) | ~15–20s |
| **Total** | | **~5–7 min** |

> **Vercel Cron note:** The Hobby plan enforces a 60-second serverless function limit.
> A full daily run (~5–7 min) exceeds this. The Vercel Cron route at `/api/cron/etl`
> uses a 55s exec timeout; partial completion is logged. If full coverage is needed,
> run domain-specific crons or upgrade to a Pro plan (300s limit).
> To stay within 60s: `--sports-only` (~15s) or `--markets-only` (~2–3 min, still over).
> The safest sub-60s option is a subset: `--skip-news --skip-markets` (~30s).

### What each domain does on a daily run

#### Markets (Finnhub + FMP + AV)

Per ticker:

| Asset type | Action | Source | Table |
|------------|--------|--------|-------|
| stock/ETF | Fetch latest quote | Finnhub `/quote` | `stock_quotes` |
| crypto | Fetch latest quote | Finnhub `/quote` (via `BINANCE:*USDT`) | `stock_quotes` |
| forex | Fetch latest quote | FMP `/stable/quote` | `stock_quotes` |
| commodity | Fetch latest quote | FMP `/stable/quote` | `stock_quotes` |
| stock | Fetch company news (7-day window) | Finnhub `/company-news` | `company_news` |

Then once (not per-ticker):

| Action | Source | Table |
|--------|--------|-------|
| Fetch market news (4 categories) | Finnhub `/news` | `market_news` |
| Fetch AV sentiment (5 topics) | AV `NEWS_SENTIMENT` | `news_sentiment` |
| Treasury rates + 7 macro indicators | FMP `/stable/treasury-rates`, `/stable/economic-indicators` | `economic_indicators` |

Stub **missing-profile backfill** (FMP profile for `name IS NULL` stocks) was **removed from the daily ETL**; `backfill_missing_profiles()` in `markets_db_helper.py` is deprecated for one-off use only.

Profile/info updates are **not** run daily — trigger manually with FMP (`run_fmp_etl` / `sync_fmp_data`) or `--scrape-etf-info` (ETFdb).

#### Sports / News / Media

Same as seed — always fetches the current snapshot (scores, news, releases, posts).

---

### Daily run variants

```bash
# Skip slow domains when iterating on markets
python src/api/run_etl.py --markets-only

# Expanded AV sentiment (all 10 topics, ~2× AV budget)
python src/api/run_etl.py --all-sentiment-topics

# Scrape ETF info + holdings from etfdb.com (manual trigger)
python src/api/run_etl.py --scrape-etf-info

# Skip AV sentiment entirely (quotes + news only, saves 5 AV calls)
python src/api/run_etl.py --skip-sentiment
```

> **Quote backfill removed from daily run.** OHLCV history is AV-expensive (1 call/ticker/run).
> Use `run_db_seed.py --backfill-quotes N` for any historical backfill needs.

---

## Decision Tree

```
New environment?
  └─ YES → python src/api/run_db_seed.py
  └─ NO  → python src/api/run_etl.py

Need to backfill missed OHLCV history?
  └─ python src/api/run_db_seed.py --backfill-quotes N  (run_etl.py no longer supports this)

Daily Run — budget constraints?
  ├─ AV budget tight      → omit --all-sentiment-topics (default 5 topics)
  └─ AV budget very tight → add --skip-sentiment (0 AV calls)

Running on Vercel Cron (60s limit)?
  ├─ Full run exceeds limit — partial completion is normal
  └─ For guaranteed completion: use --sports-only or --skip-news --skip-markets
```

---

## Key Differences: Seed vs. Daily

| Behaviour | Seed (`run_db_seed.py`) | Daily (`run_etl.py`) |
|-----------|------------------------|----------------------|
| Entry point | `run_db_seed.py` | `run_etl.py` |
| Quote history depth | N days (default 30) via `--backfill-quotes` | Today's quote only — no backfill |
| AV key selection | Round-robin per ticker | Round-robin per call |
| AV rate limiting | Interleaved with domain ETL (no explicit sleep) | Per-key sliding-window deque |
| Company news | Skipped during backfill; fetched in Phase 9 | Always fetched (7-day window) |
| ETF holdings | AV `ETF_PROFILE` — full upsert (Phase 2) | Not run (manual only) |
| Economic indicators | FMP full history — Phase 10 (~8 calls) | ~8 calls/day (incremental) |
| AV sentiment | All 10 topics (Phase 8) | 5 topics (10 with `--all-sentiment-topics`) |
| AV calls per run | ~36 (backfill) + 23 (holdings) + 10 (sentiment) = 69 | 5–10 (sentiment only) — no backfill |
| Typical duration (3 AV keys) | ~12–18 min | ~5–7 min |
| Vercel Cron compatible? | No (too long) | No (exceeds 60s limit) |
