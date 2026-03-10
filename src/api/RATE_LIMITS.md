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
- `GET /quote` — latest stock quote
- `GET /stock/profile2` — company profile (stocks only; ETFs return empty)
- `GET /company-news` — per-ticker news
- `GET /news` — general market news (general, forex, crypto, merger)

**Deprecated (commented out):**
- `GET /stock/candle` — replaced by Alpha Vantage for all candle/history needs

---

## Alpha Vantage (Markets — daily OHLCV candles & quote backfill)

| Tier | Requests/minute | Requests/day | Notes |
|------|----------------|--------------|-------|
| Free | 5 | **25** | Hard daily cap; rotation across keys helps |

**Implementation:** per-key minimum interval of **12.5 s** (`_AV_MIN_INTERVAL`) with automatic key rotation in `fetch_stock_candles_av()`.
Keys are tried in order; if a key returns a rate-limit message it rotates to the next.

**Env vars (round-robin rotation):**
```
ALPHA_VANTAGE_API_KEY
ALPHA_VANTAGE_API_KEY_1
ALPHA_VANTAGE_API_KEY_2
ALPHA_VANTAGE_API_KEY_3
```

**Endpoints actively used:**
- `GET /query?function=TIME_SERIES_DAILY` — daily OHLCV (`fetch_stock_candles_av`, `fetch_historical_quotes`)

**Practical note:** with 13 watchlist tickers and a 25 req/day cap across all keys, backfilling the full watchlist in one run is not possible. Run in batches across days or add more keys.

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
- `GET /api/v3/profile/{symbol}` — enriched company profile (sector, description, CEO, HQ, beta)

**Endpoints available but NOT wired into daily ETL (future fundamentals):**
- `/api/v3/income-statement/{symbol}` — income statements
- `/api/v3/balance-sheet-statement/{symbol}` — balance sheets
- `/api/v3/cash-flow-statement/{symbol}` — cash flow statements
- `/api/v3/key-metrics/{symbol}` — P/E, EPS, ROE, margins
- `/api/v3/financial-ratios/{symbol}` — financial ratios
- `/api/v3/analyst-estimates/{symbol}` — analyst estimates
- `/api/v3/insider-trading/{symbol}` — insider trades
- `/api/v3/press-releases/{symbol}` — press releases

**Daily budget plan (13-ticker watchlist):**

| Data | Tickers | Calls | Cadence |
|------|---------|-------|---------|
| ETF info (SPY, QQQ, DIA) | 3 | 3 | Daily |
| ETF holdings | 3 | 3 | Weekly |
| Company profiles | 10 stocks | 10 | Weekly |
| **Daily average** | | **~6** | — |
| **Budget headroom** | | **~244/day** | — |

**Auth:** `?apikey=KEY` query param appended to all requests (no header required).

---

## NewsAPI — NOT CURRENTLY USED

Referenced in old SQL migrations and `src/api/README.md` but **not called by any active fetcher**.
Env var `NEWS_API_KEY` is vestigial. Free tier limit for reference: 100 req/day.
