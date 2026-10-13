# Deduplication & Upsert Strategy

## Design Principle

Every table in the `info_agg` schema uses a UNIQUE constraint as its natural dedup key. All
DB writes across the pipeline use `upsert(..., on_conflict=<key>)` — there are no raw `INSERT`
statements. This means re-running any ETL job (daily or backfill) is always safe and idempotent.

---

## Per-Table Reference

### Markets

#### `stocks`

| Field | Value |
|---|---|
| Dedup key | `ticker` |
| UNIQUE constraint | `ticker TEXT NOT NULL UNIQUE` (`02_tables.sql`) |
| `on_conflict` | `'ticker'` |
| Behavior on conflict | Update all mutable fields (name, sector, asset_type, etc.) |
| DB helper | `get_or_create_stock()` — `markets/markets_db_helper.py` |

---

#### `stock_quotes`

| Field | Value |
|---|---|
| Dedup key | `(stock_id, quote_timestamp)` |
| UNIQUE constraint | `UNIQUE (stock_id, quote_timestamp)` (`02_tables.sql`) |
| `on_conflict` | `'stock_id,quote_timestamp'` |
| Behavior on conflict | Update OHLCV fields (open, high, low, close, volume) |
| DB helper | `upsert_daily_stock_quotes_batch()` — `markets/markets_db_helper.py`; `insert_stock_quotes_batch()` (bulk) |

---

#### `company_news`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Skip (`ignore_duplicates=True`, insert-or-skip) — an existing article is never rewritten |
| DB helper | `insert_company_news()`, called by `sync_stock_data()` (news branch) — `markets/markets_db_helper.py` |

See [Note 1](#note-1--finnhub-numeric-id-field) regarding the Finnhub `id` field.

---

#### `market_news`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update headline, summary, source, image, datetime |
| DB helper | `sync_market_news()` — `markets/markets_db_helper.py` |

See [Note 1](#note-1--finnhub-numeric-id-field) regarding the Finnhub `id` field.

---

#### `news_sentiment`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `url TEXT NOT NULL UNIQUE` (`02_tables.sql`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update sentiment score, label, ticker relevance scores |
| DB helper | `insert_news_sentiment()` — `markets/markets_db_helper.py`; called by `sync_news_sentiment()` |

Source: Alpha Vantage News Sentiment API.

---

#### `etf_holdings`

| Field | Value |
|---|---|
| Dedup key | `(etf_stock_id, asset_stock_id, as_of_date)` |
| UNIQUE constraint | `UNIQUE (etf_stock_id, asset_stock_id, as_of_date)` (`02_tables.sql`) |
| `on_conflict` | `'etf_stock_id,asset_stock_id,as_of_date'` |
| Behavior on conflict | Update weight, shares, market value |
| DB helper | `upsert_etf_holdings()` — `markets/markets_db_helper.py` |

---

#### `etf_sectors`

| Field | Value |
|---|---|
| Dedup key | `(etf_stock_id, sector, as_of_date)` |
| UNIQUE constraint | `UNIQUE (etf_stock_id, sector, as_of_date)` (`02_tables.sql`) |
| `on_conflict` | `'etf_stock_id,sector,as_of_date'` |
| Behavior on conflict | Update weight percentage |
| DB helper | `upsert_etf_sectors()` — `markets/markets_db_helper.py` |

---

#### `economic_indicators`

| Field | Value |
|---|---|
| Dedup key | `(indicator_name, date)` |
| UNIQUE constraint | `UNIQUE (indicator_name, date)` (`02_tables.sql`) |
| `on_conflict` | `'indicator_name,date'` |
| Behavior on conflict | Update `value` |
| DB helper | `upsert_economic_indicators()` — `markets/markets_db_helper.py`; called by `sync_economic_indicators()` |

Sources: FMP treasury rates (1 call, 9 term columns flattened to rows) + 7 macro indicators.
Runs as part of every `run_etl.py` daily run (not gated behind a flag) — `--economic-indicators-only`
was a `run_db_seed.py`-only flag and doesn't exist on `run_etl.py`.

---

### Sports

#### `sports_scores`

| Field | Value |
|---|---|
| Dedup key | `(league_id, event_id)` |
| UNIQUE constraint | `UNIQUE (league_id, event_id)` (`02_tables.sql`) |
| `on_conflict` | `'league_id,event_id'` |
| Behavior on conflict | Update ALL mutable fields: home_score, away_score, status, status_detail, home_record, away_record, broadcast, venue |
| DB helper | `sync_all_sports_data()` — `sports/sports_db_helper.py`; rows upserted by `_upsert_sports_score_records()` |

See [Note 2](#note-2--sports-scores-state-transitions).

---

#### `sports_news`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update headline, description, published_at |
| DB helper | `_upsert_sports_news_records()` (called by `sync_all_sports_data()`) — `sports/sports_db_helper.py` |

---

### News

#### `news_articles`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update title, abstract, section, published_date |
| DB helper | `sync_nyt_data()` → `insert_nyt_articles()` — `news/news_db_helper.py` |

Both the NYT Top Stories API and the NYT Archive API write to this table using the same
`on_conflict='url'` upsert — no risk of cross-source duplication.

---

### Media

#### `youtube_videos`

| Field | Value |
|---|---|
| Dedup key | `(video_id, region_code)` |
| UNIQUE constraint | `UNIQUE (video_id, region_code)` (`02_tables.sql`) |
| `on_conflict` | `'video_id,region_code'` |
| Behavior on conflict | Update stats (views, likes, comments) and refresh `fetched_at` |
| DB helper | `sync_youtube_data()` — `media/media_db_helper.py` |

Trending videos are mutable (view/like/comment counts change over time), and `fetched_at` is
refreshed on every run so retention (which keys off `fetched_at`) keeps rows that are still
trending. Updating on conflict is intentional.

Spotify (playlists, Top Podcasts) is live-embedded on the frontend with no backend fetch or
table — nothing to deduplicate. Reddit (`reddit_posts`) was removed.

---

## Summary Table

| Table | UNIQUE constraint | `on_conflict` key | Match |
|---|---|---|---|
| `stocks` | `ticker` | `ticker` | ✓ |
| `stock_quotes` | `(stock_id, quote_timestamp)` | `stock_id,quote_timestamp` | ✓ |
| `company_news` | `url` | `url` | ✓ |
| `market_news` | `url` | `url` | ✓ |
| `news_sentiment` | `url` | `url` | ✓ |
| `etf_holdings` | `(etf_stock_id, asset_stock_id, as_of_date)` | `etf_stock_id,asset_stock_id,as_of_date` | ✓ |
| `etf_sectors` | `(etf_stock_id, sector, as_of_date)` | `etf_stock_id,sector,as_of_date` | ✓ |
| `economic_indicators` | `(indicator_name, date)` | `indicator_name,date` | ✓ |
| `sports_scores` | `(league_id, event_id)` | `league_id,event_id` | ✓ |
| `sports_news` | `url` | `url` | ✓ |
| `news_articles` | `url` | `url` | ✓ |
| `youtube_videos` | `(video_id, region_code)` | `video_id,region_code` | ✓ |
| `sports_standings` | `(league_id, team_abbrev, season)` | `league_id,team_abbrev,season` | ✓ |

All 13 tables: UNIQUE constraint matches `on_conflict` key. No raw INSERTs anywhere in the pipeline.

---

## Notes & Future Enhancements

### Note 1 — Finnhub numeric `id` field

The Finnhub `/company-news` and `/news` endpoints return a numeric `id` field per article.
`finnhub.py` does not currently capture this field — `url` is used as the dedup key instead.
URL is stable and unique per Finnhub article, so this is **not a bug**. A potential future
enhancement would be adding a `finnhub_id` column to `company_news` and `market_news` to
enable cross-source dedup (e.g. same article appearing under two different tickers). No
immediate action required.

### Note 2 — Sports scores state transitions

`sports_scores` upserts on `(league_id, event_id)` and overwrites **all** mutable fields on
conflict: `home_score`, `away_score`, `status`, `status_detail`, `home_record`, `away_record`,
`broadcast`, `venue`. This correctly handles the full game lifecycle:

```
Scheduled → In Progress → Final
```

Each ETL run simply overwrites the row with the latest ESPN snapshot. No duplicates are
possible. This is working as intended.
