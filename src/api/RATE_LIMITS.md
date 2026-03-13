# API Rate Limits

Reference for every external API used in the ETL pipeline. Check here before adding new endpoints or increasing call frequency.

---

## Finnhub (Markets — quotes, profiles, news)

| Tier | Requests/minute | Daily cap | Notes |
|------|----------------|-----------|-------|
| Free | 60 | None | Most endpoints |
| Free | — | — | `/etf/profile` returns **403** — premium only |

**Implementation:** sliding-window rate limiter `_fh_rate_limit()` in `markets_fetcher.py`.
Sleeps only when the 60-call window is full; no fixed per-call delay.

**Env var:** `FINNHUB_API_KEY`

**Endpoints actively used:**
- `GET /quote` — latest stock/ETF quote
- `GET /crypto/candle` — daily crypto quote (BTC, ETH, XRP via `BINANCE:*USDT` symbols)
- `GET /stock/profile2` — company profile (stocks only; ETFs return empty)
- `GET /company-news` — per-ticker news
- `GET /news` — general market news (general, forex, crypto, merger)

**Deprecated (commented out):**
- `GET /stock/candle` — replaced by Alpha Vantage for all candle/history needs

---

## Alpha Vantage (Markets — news sentiment)

| Tier | Requests/minute | Requests/day | Notes |
|------|----------------|--------------|-------|
| Free | 5 | **25** | Hard daily cap; rotation across keys helps |

**Implementation:** per-key sliding-window deque `_av_rate_limit(key)` in `alpha_vantage.py` — identical pattern to Finnhub's `_fh_rate_limit()`.
Bursts up to 5 calls immediately; sleeps only when the 60-second window is full.
Keys are tried in order; if a key returns a rate-limit message it rotates to the next.

**Env vars (round-robin rotation):**
```
ALPHA_VANTAGE_API_KEY
ALPHA_VANTAGE_API_KEY_1
ALPHA_VANTAGE_API_KEY_2
ALPHA_VANTAGE_API_KEY_3
```

**Endpoints actively used:**
- `GET /query?function=NEWS_SENTIMENT&topics={topic}` — news sentiment by topic (`fetch_news_sentiment`)
  Called 5–10× per daily ETL run (see `SENTIMENT_TOPICS_DEFAULT` / `SENTIMENT_TOPICS_ALL` in `run_etl.py`)
- `GET /query?function=TIME_SERIES_DAILY&symbol={ticker}` — stock OHLCV backfill (`fetch_historical_quotes`)
- `GET /query?function=DIGITAL_CURRENCY_DAILY&symbol={symbol}` — crypto OHLCV backfill (`fetch_crypto_candles_av`)
- `GET /query?function=ETF_PROFILE&symbol={ticker}` — ETF holdings (`fetch_etf_holdings_av`)
  Called once per ETF ticker during seed Phase 2 (23 calls for the current basket)

**Daily budget (3 keys × 25 req/day = 75 total):**

Round-robin key selection (`_get_keys_round_robin` in `alpha_vantage.py`) distributes
successive calls evenly: call 1 → key1, call 2 → key2, call 3 → key3, call 4 → key1, …

| Usage | Total calls | Calls/key (round-robin, 3 keys) |
|-------|------------|----------------------------------|
| Quote backfill — 36 tickers | 36 | ~12 |
| ETF holdings — 23 ETFs (`ETF_PROFILE`) | 23 | ~8 |
| Sentiment — 10 topics (`--all-sentiment-topics`) | 10 | ~4 |
| **Seed total** | **69** | **~23** |
| Sentiment — 5 topics (daily default) | 5 | ~2 |
| **Daily total (no backfill)** | **5** | **~2** |
| **Budget headroom (seed)** | **+6** | — |

In `run_db_seed.py`, AV backfill is split into 10-ticker batches interleaved with
other domain ETL (FMP → Sports → News → Media). AV ETF holdings (23 calls) are
fetched in Phase 2 after FMP stock profiles, so the 5 req/min window resets
between Phase 1 and Phase 2 AV work. No explicit `sleep()` is used — the
`_av_rate_limit()` deque handles any sub-window pauses automatically.

Phase 0 of `run_db_seed.py` reports the live key count and budget breakdown
before any calls are made, making it easy to spot configuration issues early.

Use `--all-sentiment-topics` (10 topics) only during seed or when budget allows.

---

## New York Times API (News)

| Tier | Requests/minute | Requests/day | Notes |
|------|----------------|--------------|-------|
| Free | 10 | 500 | Shared across all NYT API endpoints |

**Implementation:** `time.sleep(7.0)` between per-section calls in `news_db_helper.py`.
7 s spacing means 10 calls take ≥ 63 s — safely under the 10 req/min cap.

**Env var:** `NYT_API_KEY`

**Endpoints actively used:**
- `GET /topstories/v2/{section}.json` — top stories by section
- `GET /mostpopular/v2/viewed/{period}.json` — most popular articles

---

## ESPN API (Sports)

| Tier | Requests/minute | Daily cap | Notes |
|------|----------------|-----------|-------|
| Public (undocumented) | Unknown | Unknown | Unofficial API; no published limits |

**Implementation:** no rate limiting applied. Used conservatively (one call per sport/league per ETL run).

**No API key required.**

**Endpoints actively used:**
- `GET /apis/site/v2/sports/{sport}/{league}/news`
- `GET /apis/site/v2/sports/{sport}/{league}/scoreboard`

---

## Spotify API (Media)

| Tier | Requests/second | Notes |
|------|----------------|-------|
| Client Credentials (free) | ~30 | App-level token; not user-scoped |

**Implementation:** no explicit rate limiting — current call volume (1–2 calls per ETL run) is well within limits.
Access token expires after **3600 s** and is re-fetched at the start of each ETL run.

**Env vars:** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

**Endpoints actively used:**
- `POST /api/token` — Client Credentials token exchange
- `GET /v1/browse/new-releases` — new album releases

---

## Reddit API (Media — unauthenticated)

| Tier | Requests/minute | Notes |
|------|----------------|-------|
| Unauthenticated | 60 | Must send a descriptive `User-Agent` |

**Implementation:** `time.sleep(1)` between subreddit calls in `media_db_helper.py`.

**No API key required** (unauthenticated public API).

**Endpoints actively used:**
- `GET /r/{subreddit}/hot.json`

---

## Financial Modeling Prep / FMP (Markets — ETF profiles, holdings, fundamentals)

| Tier | Requests/day | Notes |
|------|-------------|-------|
| Free | **250** | Hard daily cap; resets at midnight |

**Implementation:** daily counter `_FMP_DAILY_COUNT` + `_FMP_DAILY_DATE` in `markets/fmp.py`.
- Issues a `warnings.warn` at 220 calls (configurable via `_FMP_WARN_THRESHOLD`)
- Raises `RuntimeError` at 250 — callers catch this and abort remaining FMP calls gracefully
- Counter resets automatically when `date.today()` differs from `_FMP_DAILY_DATE`

**Env var:** `FMP_API_KEY`

**Endpoints actively used in daily ETL:**
- `GET /stable/etf/information?symbol=` — ETF name, expense ratio, AUM, asset class (fills Finnhub 403 gap)
- `GET /stable/etf/holdings?symbol=` — per-holding weight %, shares, market value → `etf_holdings` table
- `GET /stable/profile/{symbol}` — enriched company profile (sector, description, CEO, HQ, beta)
- `GET /stable/historical-price-full/{symbol}` — daily OHLCV backfill → `stock_quotes` table
  (~13 calls when `--backfill-quotes` is used, one per watchlist ticker)

**Endpoints available but NOT wired into daily ETL (future fundamentals):**
- `/stable/income-statement/{symbol}` — income statements
- `/stable/balance-sheet-statement/{symbol}` — balance sheets
- `/stable/cash-flow-statement/{symbol}` — cash flow statements
- `/stable/key-metrics/{symbol}` — P/E, EPS, ROE, margins
- `/stable/financial-ratios/{symbol}` — financial ratios
- `/stable/analyst-estimates/{symbol}` — analyst estimates
- `/stable/insider-trading/{symbol}` — insider trades
- `/stable/press-releases/{symbol}` — press releases

**Daily budget plan (13-ticker watchlist):**

| Data | Tickers | Calls | Cadence |
|------|---------|-------|---------|
| ETF info (SPY, QQQ, DIA) | 3 | 3 | Daily |
| ETF holdings | 3 | 3 | Weekly |
| Company profiles | 10 stocks | 10 | Weekly |
| Historical backfill | 13 tickers | 13 | On-demand (`--backfill-quotes`) |
| **Daily average (no backfill)** | | **~6** | — |
| **Daily average (with backfill)** | | **~19** | — |
| **Budget headroom** | | **~231–244/day** | — |

**Auth:** `?apikey=KEY` query param appended to all requests (no header required).

---

## NewsAPI — NOT CURRENTLY USED

Referenced in old SQL migrations and `src/api/README.md` but **not called by any active fetcher**.
Env var `NEWS_API_KEY` is vestigial. Free tier limit for reference: 100 req/day.
