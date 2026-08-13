# ETL Runbook

Two distinct operating modes existed at one point: **Initial Seed** (run once per environment)
and **Daily Run** (now automated via GitHub Actions, not Vercel Cron — see below). The Initial
Seed path is currently broken; see the notice under that heading before reading further.

---

## Initial Seed — ARCHIVED, currently broken (reference only)

> `run_db_seed.py` was moved to `src/api/archive/` and no longer runs: it calls
> `run_sports_etl(supabase, backfill_days=...)` and `run_news_etl(supabase, backfill_days=...)`,
> but the current `run_etl.py` versions of those functions don't accept a `backfill_days`
> kwarg — it would raise `TypeError` immediately. There is presently no working path to
> backfill historical quotes or news. `backfill_scores.py` (documented in the repo root
> `CLAUDE.md` and `src/api/README.md`) is the one backfill tool that still works, and it only
> covers ESPN scores. Everything below describes the old design as it was intended to work,
> kept for whoever eventually repairs or replaces it — do not run these commands expecting
> them to succeed today.

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
domain work (ESPN, NYT, YouTube) rather than burning a `sleep()` call.

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
| 7 | Media — YouTube | >60s → AV window reset ✓ |
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
| 7 | YouTube (1 call) | ~1–2s |
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
| Fetch trending videos | YouTube `videos.list?chart=mostPopular` | `youtube_videos` |

Spotify (playlists, Top Podcasts) is live-embedded on the frontend — no fetch, no table, nothing
to seed or backfill. Reddit was removed.

---

## Daily Run

```bash
source _agg_venv/bin/activate   # from repo root
python src/api/run_etl.py
```

Runs all four domains **in parallel** (`ThreadPoolExecutor`, one thread per domain) — this
replaced the old sequential design specifically so the whole run finishes well under 60s; see
the ETL Performance Requirement in the repo root `CLAUDE.md`. Wall time is set by the slowest
domain (markets), not the sum of all four. Each domain phase also has its own cooperative
`--budget-seconds` ceiling (default 50s) — it stops starting new work once spent rather than
running unbounded. See `src/api/docs/EXECUTION_ORDER.md` for the per-domain breakdown.

> **Scheduling — GitHub Actions, not Vercel Cron.** `.github/workflows/daily-etl.yml` runs
> `python src/api/run_etl.py --triggered-by cron --cleanup --season-schedules` on a schedule
> (`cron: '43 10 * * *'` UTC) and revalidates the site's cache afterward. It can also be
> triggered manually — either from the GitHub Actions UI (`workflow_dispatch`) or from the
> `/dashboard` admin page's trigger button, which calls `POST /api/etl`. That route exists at
> all because Vercel's serverless runtime has no Python interpreter — it can only ask GitHub
> Actions to run the pipeline, never run it in-process. There is no Vercel Cron route in this
> project; an older `/api/cron/etl` route referenced by previous docs no longer exists.

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

Then once, run in parallel with each other since each hits a different API:

| Action | Source | Table |
|--------|--------|-------|
| Fetch market news (4 categories) | Finnhub `/news` | `market_news` |
| Fetch AV sentiment (all 10 topics — no partial-topic mode) | AV `NEWS_SENTIMENT` | `news_sentiment` |
| Treasury rates + 7 macro indicators | FMP `/stable/treasury-rates`, `/stable/economic-indicators` | `economic_indicators` |

Stub **missing-profile backfill** (FMP profile for `name IS NULL` stocks) was **removed from the daily ETL**; `backfill_missing_profiles()` in `markets_db_helper.py` is deprecated for one-off use only.

Profile/info updates are **not** run daily — trigger manually with FMP (`run_fmp_etl` / `sync_fmp_data`) or `--scrape-etf-info` (ETFdb).

#### Sports / News / Media

Same current-snapshot fetch the (now-broken) seed used to also do: scores, news, releases,
posts — just without the seed's historical backfill.

---

### Daily run variants

```bash
# Skip slow domains when iterating on markets
python src/api/run_etl.py --markets-only

# Scrape ETF info + holdings from etfdb.com (manual trigger)
python src/api/run_etl.py --scrape-etf-info

# Skip AV sentiment entirely (quotes + news only, saves 5 AV calls)
python src/api/run_etl.py --skip-sentiment
```

> **Quote backfill has no working path right now.** OHLCV history is AV-expensive (1
> call/ticker/run) and was intentionally kept out of the daily run for that reason. It used to
> live in `run_db_seed.py --backfill-quotes N`, but that script is archived and broken (see the
> notice at the top of this doc) — there's currently no substitute.

---

## Decision Tree

```
New environment?
  └─ There's no working seed path today (see "Initial Seed" notice above).
     python src/api/run_etl.py will populate current-snapshot data (quotes, news,
     scores) fine; historical OHLCV/news backfill needs the seed path repaired first.

Already seeded — routine operation?
  └─ python src/api/run_etl.py  (or let .github/workflows/daily-etl.yml run it on schedule)

Missed some ESPN score history (outage, late backfill)?
  └─ python src/api/backfill_scores.py --season current  (safe to re-run, upserts by event)

Daily Run — AV budget constraints?
  └─ AV budget tight → add --skip-sentiment (0 AV calls; sentiment is otherwise always
     all 10 topics, there's no partial-topic flag)

Need faster-than-daily updates between full runs?
  └─ python src/api/run_quick_refresh.py --tier a   (every 15 min, no daily budget spent)
  └─ python src/api/run_quick_refresh.py --tier b   (hourly, adds NYT + ESPN news + FMP)
```

---

## Key Differences: Seed vs. Daily

| Behaviour | Seed (`run_db_seed.py`, **archived/broken**) | Daily (`run_etl.py`) |
|-----------|------------------------|----------------------|
| Entry point | `archive/run_db_seed.py` — does not run | `run_etl.py` |
| Domain execution | Interleaved with AV backfill batches, one domain at a time | All 4 domains in parallel (`ThreadPoolExecutor`) |
| Quote history depth | N days (default 30) via `--backfill-quotes`, when it worked | Today's quote only — no backfill |
| AV key selection | Round-robin per ticker | Round-robin per call |
| AV rate limiting | Interleaved with domain ETL (no explicit sleep) | `MinInterval` slot reservation (>=1.25s gap), reserves under lock then sleeps outside it |
| Company news | Skipped during backfill; fetched in Phase 9 | Always fetched (7-day window) |
| ETF holdings | AV `ETF_PROFILE` — full upsert (Phase 2) | Not run (manual only) |
| Economic indicators | FMP full history — Phase 10 (~8 calls) | ~8 calls/day (incremental) |
| AV sentiment | All 10 topics (Phase 8) | All 10 topics (no partial-topic mode) |
| Typical duration | ~12–18 min with 3 AV keys, when it worked | Well under 60s (target; cooperative 50s budget default) |
| Scheduling | Manual only, when it worked | `.github/workflows/daily-etl.yml` (cron `43 10 * * *` UTC) + manual `workflow_dispatch` from `/dashboard` |
