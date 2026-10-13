# ETL Pipeline

Python ETL for the Info Aggregator. Fetches from external APIs and upserts into Supabase
(`info_agg` schema). Commands assume the **repo root** with the venv active:

```bash
source _agg_venv/bin/activate
```

---

## Directory Structure

```
src/api/
├── run_etl.py              # Daily orchestrator: 5 fetch domains in parallel, then summary
├── run_quick_refresh.py    # Intraday Tier A / Tier B refresh — no backfill
├── run_test.py             # Dry-run: one sample call per Finnhub/AV/FMP/ESPN/NYT endpoint, no DB writes
├── backfill_scores.py      # Standalone recovery tool for historical ESPN scores
├── etl_lib.py              # Shared plumbing: logging + secret redaction, HTTP session, MinInterval,
│                           # EndpointBreaker, chunked_upsert, env preflight, etl_runs bookkeeping
├── docs/                   # RATE_LIMITS, RUNBOOK, EXECUTION_ORDER, DEDUPLICATION
│
├── markets/
│   ├── baskets.json        # Watchlist: 8 groups, 54 tickers
│   ├── finnhub.py          # Quotes (stocks/ETFs/crypto), company + market news
│   ├── fmp.py              # Commodity quotes, treasury + macro indicators, company profiles
│   ├── frankfurter.py      # Forex: keyless ECB reference rates, every pair in one request
│   ├── alpha_vantage.py    # News sentiment
│   ├── etfdb.py            # ETF info + top holdings scraper (manual, --scrape-etf-info)
│   └── markets_db_helper.py
├── sports/
│   ├── espn.py             # Scoreboards (scores + schedules), news, standings
│   └── sports_db_helper.py
├── news/
│   ├── nyt.py              # Top Stories + Most Popular
│   └── news_db_helper.py
├── media/
│   ├── youtube.py          # Trending videos
│   └── media_db_helper.py
├── misc/                   # Almanac feeds → misc_content (JSONB)
│   ├── weather.py          # Visual Crossing
│   ├── holidays.py         # Calendarific
│   ├── countries.py        # REST Countries v5
│   ├── wikipedia.py        # Random summary + On This Day
│   ├── words.py            # Merriam-Webster word of the day (RSS)
│   ├── facts.py            # uselessfacts
│   └── misc_db_helper.py
├── summary/                # AI briefings → misc_content ('summary','day'|'week')
│   ├── gemini.py           # Gemini REST client
│   └── summary_db_helper.py
│
└── archive/                # Retired, not run: run_db_seed.py (broken), seed.py, av_seed.py,
                            # generate_snippets.py, old schema docs
```

Spotify (playlists, Top Podcasts) is live-embedded on the frontend (`lib/top-podcasts.ts`) — no
fetcher or table. Python dependencies: `requirements.txt` at the repo root.

---

## Setup

1. `pip install -r requirements.txt`

2. **`.env.local`** in the repo root:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

   # Markets
   FINNHUB_API_KEY_1=<key>          # _2, _3 optional, rotated
   FMP_API_KEY=<key>
   ALPHA_VANTAGE_API_KEY=<key>      # _1, _2, _3 optional, rotated

   # News
   NYT_API_KEY_1=<key>              # _2, _3 optional, rotated

   # Media
   YOUTUBE_API_KEY=<key>

   # Misc (each optional — a missing key skips that card)
   WEATHER_API_KEY=<key>
   CALENDAR_API_KEY=<key>
   COUNTRIES_API_KEY=<key>

   # Summary (optional — unset skips both briefings)
   GEMINI_API_KEY=<key>
   GEMINI_MODEL=<model>             # optional, pinned ahead of the built-in list

   ETL_LOG_LEVEL=INFO               # optional
   ```
   Forex (Frankfurter), ESPN, Wikipedia, Merriam-Webster and uselessfacts need no key.

3. **Apply DB migrations** in order, once per environment: `supabase/01_schema.sql` through
   `supabase/13_notifications.sql` (see the root `CLAUDE.md` for what each does; `13` needs the
   shared `notify` platform from cmf-tracker applied first).

---

## Watchlist — `baskets.json`

All market ETL is driven by `markets/baskets.json`. The group sets `asset_type` and quote source:

| Group | Asset type | Tickers | Quote source |
|-------|-----------|---------|--------------|
| `core_stocks` | `stock` | AAPL MSFT NVDA AMZN GOOGL META TSLA BRK-B JPM AVGO AMD INTC SPCX (13) | Finnhub `/quote` |
| `core_market` | `etf` | VTI SPY QQQ IWM VXUS (5) | Finnhub `/quote` |
| `sectors` | `etf` | XLC XLY XLP XLE XLF XLV XLI XLB XLRE XLK XLU (11) | Finnhub `/quote` |
| `breadth` | `etf` | RSP VUG VTV (3) | Finnhub `/quote` |
| `risk` | `etf` | TLT HYG GLD SLV DBC UUP (6) | Finnhub `/quote` |
| `crypto` | `crypto` | BTC ETH XRP (3) | Finnhub `/quote` (`BINANCE:*USDT`) |
| `forex` | `forex` | USDEUR USDGBP USDJPY USDCAD USDCHF USDAUD USDCNY USDINR USDMXN USDNZD (10) | Frankfurter (one request) |
| `commodities` | `commodity` | BZUSD SIUSD GCUSD (3) | FMP `/stable/quote` |

To add or remove tickers, edit `baskets.json` — no code changes required.

---

## Running the ETL

See **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)** for per-domain detail, run status rules and the
decision tree.

```bash
python src/api/run_etl.py                                    # Daily run: all domains
python src/api/run_etl.py --markets-only                     # Or --sports/--news/--media/--misc/--summary-only
python src/api/run_etl.py --triggered-by cron --cleanup --season-schedules   # What the scheduled daily runs

python src/api/run_quick_refresh.py --tier a                 # Tier A
python src/api/run_quick_refresh.py --tier b                 # Tier B

python src/api/backfill_scores.py --season current           # ESPN score history, safe to re-run
```

The full run must finish **under 60 seconds** (root `CLAUDE.md`); the domain phase has a
cooperative 50s budget.

> **No working initial-seed path.** `archive/run_db_seed.py` is broken (it passes a
> `backfill_days` kwarg the current domain functions don't accept). `backfill_scores.py` is the
> only working backfill and covers ESPN scores only.

### Scheduling

**Vercel Cron is the clock; GitHub Actions is the runtime.** `vercel.json` holds 16 entries, each
firing at most once a day (±59 min), that call `GET /api/cron/etl?job=daily|a|b`
(`app/api/cron/etl/route.ts`). The route fires a `workflow_dispatch` on
`.github/workflows/daily-etl.yml` (job `daily`) or `intraday-refresh.yml` (jobs `a`/`b`); neither
workflow has a `schedule:` trigger.

| Job | Entries | UTC slots |
|-----|---------|-----------|
| daily | 1 | 09 |
| Tier B | 6 | 10, 11, 12, 16, 19, 22 |
| Tier A | 9 | 13, 14, 15, 17, 18, 20, 21, 23, 01 |

Manual runs: the `/dashboard` admin button (`POST /api/etl`) or the Actions UI. See "ETL
Scheduling" in the root `CLAUDE.md` for why the schedule left GitHub's `schedule:`.

### `run_etl.py` flags

| Flag | Effect |
|------|--------|
| `--sports-only` / `--markets-only` / `--news-only` / `--media-only` / `--misc-only` | Run one fetch domain (also skips the summary) |
| `--summary-only` | Regenerate the AI briefings alone, from current DB rows |
| `--skip-sports` / `--skip-markets` / `--skip-news` / `--skip-media` / `--skip-misc` | Skip one fetch domain |
| `--skip-summary` | Skip the AI briefings (no Gemini call) |
| `--skip-sentiment` | Skip AV news sentiment (otherwise always all 10 topics) |
| `--scrape-etf-info` | Scrape ETF info + top holdings from etfdb.com, then exit (manual) |
| `--watchlist TICKER ...` | Override the basket watchlist |
| `--test` | Run `run_test.py` (dry-run, no DB writes) |
| `--output FILE` | Write results JSON to FILE |
| `--triggered-by {manual,cron,dispatch}` | Recorded in `etl_runs` (default `manual`) |
| `--budget-seconds N` | Cooperative wall-clock budget for the domain phase (default `50.0`) |
| `--cleanup` | Run `info_agg.cleanup_daily()` retention afterwards |
| `--season-schedules` | Also fetch full season schedules for in-season leagues |

### `run_quick_refresh.py` flags

| Flag | Default | Effect |
|------|---------|--------|
| `--tier {a,b}` | `a` | Tier A: Finnhub quotes (no forex/commodities), ESPN scoreboards, Finnhub market news — no daily API budget. Tier B: Tier A + NYT top stories, ESPN news, forex (Frankfurter) and commodity (FMP, 3 calls) quotes |
| `--triggered-by {manual,cron,dispatch}` | `manual` | Recorded in `etl_runs` |

AV sentiment, FMP economic indicators, misc, the AI briefings and retention cleanup are
daily-only.

---

## Data Flow

```
baskets.json
    ├─ stocks / ETFs / crypto ──► Finnhub /quote ──────────────► stock_quotes
    ├─ forex ───────────────────► Frankfurter (ECB) ───────────► stock_quotes
    └─ commodities ─────────────► FMP /stable/quote ───────────► stock_quotes

Finnhub /company-news ─────────────────────────────────────────► company_news
Finnhub /news (general/forex/crypto) ──────────────────────────► market_news
AV NEWS_SENTIMENT (10 topics) ─────────────────────────────────► news_sentiment
FMP treasury-rates + economic-indicators (7 names) ────────────► economic_indicators
FMP profiles / etfdb.com (manual only) ────────────────────────► stocks, etf_holdings

ESPN news, scoreboard, standings ──────────────────────────────► sports_news, sports_scores, sports_standings
NYT topstories, mostpopular ───────────────────────────────────► news_articles
YouTube videos?chart=mostPopular ──────────────────────────────► youtube_videos
Visual Crossing, Calendarific, REST Countries,
  Wikipedia, Merriam-Webster, uselessfacts ────────────────────► misc_content

  (after the five domains above finish)
info_agg rows ──► Gemini ──────────────────────────────────────► misc_content ('summary', day|week)
```

---

## Rate Limits

Per-API limits, daily caps and how each fetcher enforces them are in
[`docs/RATE_LIMITS.md`](docs/RATE_LIMITS.md). The Finnhub, ESPN and NYT fetchers also sit behind
the shared circuit breaker (`etl_lib.EndpointBreaker`).
