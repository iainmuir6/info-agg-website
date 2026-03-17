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
| UNIQUE constraint | `ticker TEXT NOT NULL UNIQUE` (`02_tables.sql:99`) |
| `on_conflict` | `'ticker'` |
| Behavior on conflict | Update all mutable fields (name, sector, asset_type, etc.) |
| DB helper | `get_or_create_stock()` — `markets/markets_db_helper.py:105` |

---

#### `stock_quotes`

| Field | Value |
|---|---|
| Dedup key | `(stock_id, quote_timestamp)` |
| UNIQUE constraint | `UNIQUE (stock_id, quote_timestamp)` (`02_tables.sql:145`) |
| `on_conflict` | `'stock_id,quote_timestamp'` |
| Behavior on conflict | Update OHLCV fields (open, high, low, close, volume) |
| DB helper | `upsert_quote()` — `markets/markets_db_helper.py:148`; bulk variant at line 199 |

---

#### `company_news`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql:165`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update title, summary, image, sentiment, datetime |
| DB helper | `sync_stock_data()` (news branch) — `markets/markets_db_helper.py:241` |

See [Note 1](#note-1--finnhub-numeric-id-field) regarding the Finnhub `id` field.

---

#### `market_news`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql:189`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update headline, summary, source, image, datetime |
| DB helper | `sync_market_news()` — `markets/markets_db_helper.py:285` |

See [Note 1](#note-1--finnhub-numeric-id-field) regarding the Finnhub `id` field.

---

#### `news_sentiment`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `url TEXT NOT NULL UNIQUE` (`02_tables.sql:244`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update sentiment score, label, ticker relevance scores |
| DB helper | `upsert_news_sentiment_articles()` — `markets/markets_db_helper.py:917` |

Source: Alpha Vantage News Sentiment API.

---

#### `etf_holdings`

| Field | Value |
|---|---|
| Dedup key | `(etf_stock_id, asset_stock_id, as_of_date)` |
| UNIQUE constraint | `UNIQUE (etf_stock_id, asset_stock_id, as_of_date)` (`02_tables.sql:211`) |
| `on_conflict` | `'etf_stock_id,asset_stock_id,as_of_date'` |
| Behavior on conflict | Update weight, shares, market value |
| DB helper | `upsert_etf_holdings()` — `markets/markets_db_helper.py:552` |

---

#### `etf_sectors`

| Field | Value |
|---|---|
| Dedup key | `(etf_stock_id, sector, as_of_date)` |
| UNIQUE constraint | `UNIQUE (etf_stock_id, sector, as_of_date)` (`02_tables.sql:230`) |
| `on_conflict` | `'etf_stock_id,sector,as_of_date'` |
| Behavior on conflict | Update weight percentage |
| DB helper | `upsert_etf_sectors()` — `markets/markets_db_helper.py:591` |

---

#### `economic_indicators`

| Field | Value |
|---|---|
| Dedup key | `(indicator_name, date)` |
| UNIQUE constraint | `UNIQUE (indicator_name, date)` (`02_tables.sql:347`) |
| `on_conflict` | `'indicator_name,date'` |
| Behavior on conflict | Update `value` |
| DB helper | `upsert_economic_indicators()` — `markets/markets_db_helper.py:1072`; called by `sync_economic_indicators()` at line 1132 |

Sources: FMP treasury rates (1 call, 9 term columns flattened to rows) + 7 macro indicators.
Trigger manually: `python run_etl.py --economic-indicators-only`

---

### Sports

#### `sports_scores`

| Field | Value |
|---|---|
| Dedup key | `(league_id, event_id)` |
| UNIQUE constraint | `UNIQUE (league_id, event_id)` (`02_tables.sql:86`) |
| `on_conflict` | `'league_id,event_id'` |
| Behavior on conflict | Update ALL mutable fields: home_score, away_score, status, status_detail, home_record, away_record, broadcast, venue |
| DB helper | `sync_all_sports_data()` — `sports/sports_db_helper.py:137` |

See [Note 2](#note-2--sports-scores-state-transitions).

---

#### `sports_news`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (`02_tables.sql:56`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update headline, description, published_at |
| DB helper | `sports/sports_db_helper.py:85` |

---

### News

#### `news_articles`

| Field | Value |
|---|---|
| Dedup key | `url` |
| UNIQUE constraint | `UNIQUE (url)` (implicit — url column is UNIQUE in `02_tables.sql`) |
| `on_conflict` | `'url'` |
| Behavior on conflict | Update title, abstract, section, published_date |
| DB helper | `sync_nyt_data()` — `news/news_db_helper.py:101`; archive backfill variant at line 245 |

Both the NYT Top Stories API and the NYT Archive API write to this table using the same
`on_conflict='url'` upsert — no risk of cross-source duplication.

---

### Media

#### `spotify_releases`

| Field | Value |
|---|---|
| Dedup key | `spotify_id` |
| UNIQUE constraint | `UNIQUE (spotify_id)` (`02_tables.sql:303`) |
| `on_conflict` | `'spotify_id'` |
| Behavior on conflict | Update name, release_date, artists, image_url |
| DB helper | `sync_spotify_data()` — `media/media_db_helper.py:92` |

---

#### `reddit_posts`

| Field | Value |
|---|---|
| Dedup key | `post_id` |
| UNIQUE constraint | `UNIQUE (post_id)` (`02_tables.sql:329`) |
| `on_conflict` | `'post_id'` |
| Behavior on conflict | Update score, num_comments, title (mutable fields — intentional, see note below) |
| DB helper | `sync_reddit_data()` — `media/media_db_helper.py:160` |

Reddit posts are mutable (score and comment count change over time). Updating these fields on
conflict is intentional — each daily run reflects the current engagement snapshot.

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
| `spotify_releases` | `spotify_id` | `spotify_id` | ✓ |
| `reddit_posts` | `post_id` | `post_id` | ✓ |

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
