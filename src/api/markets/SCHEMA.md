# Markets Database Schema

This document describes the database schema for storing financial market data from Finnhub API.

## Tables

### 1. `stocks`
Stores company/symbol information.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each stock
- `ticker` (TEXT) - Stock symbol (e.g., 'AAPL', 'MSFT') - UNIQUE
- `name` (TEXT) - Company name
- `country` (TEXT) - Country where company is based
- `currency` (TEXT) - Trading currency
- `exchange` (TEXT) - Stock exchange (e.g., 'NASDAQ', 'NYSE')
- `ipo_date` (DATE) - Initial public offering date
- `market_cap` (BIGINT) - Market capitalization
- `share_outstanding` (BIGINT) - Number of outstanding shares
- `logo_url` (TEXT) - URL to company logo
- `website` (TEXT) - Company website URL
- `industry` (TEXT) - Industry classification
- `is_active` (BOOLEAN) - Whether the stock is currently active
- `created_at` (TIMESTAMP) - When the record was created
- `updated_at` (TIMESTAMP) - When the record was last updated

**Constraints:**
- UNIQUE(ticker) - Prevents duplicate tickers

**Indexes:**
- `idx_stocks_ticker` - For fast ticker lookups
- `idx_stocks_exchange` - For filtering by exchange
- `idx_stocks_industry` - For filtering by industry
- `idx_stocks_is_active` - For filtering active stocks

### 2. `stock_quotes`
Stores real-time quote data for stocks.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each quote
- `stock_id` (INTEGER) - Foreign key to `stocks.id`
- `current_price` (DECIMAL) - Current trading price
- `change_amount` (DECIMAL) - Price change from previous close
- `percent_change` (DECIMAL) - Percentage change from previous close
- `high_price` (DECIMAL) - Highest price of the day
- `low_price` (DECIMAL) - Lowest price of the day
- `open_price` (DECIMAL) - Opening price of the day
- `previous_close` (DECIMAL) - Previous day's closing price
- `quote_timestamp` (BIGINT) - Unix timestamp of the quote
- `fetched_at` (TIMESTAMP) - When the quote was fetched
- `created_at` (TIMESTAMP) - When the record was created

**Constraints:**
- FOREIGN KEY `stock_id` REFERENCES `stocks(id)` ON DELETE CASCADE
- UNIQUE(stock_id, quote_timestamp) - Prevents duplicate quotes for same timestamp

**Indexes:**
- `idx_stock_quotes_stock_id` - For filtering by stock
- `idx_stock_quotes_fetched_at` - For sorting by fetch time
- `idx_stock_quotes_quote_timestamp` - For sorting by quote time
- `idx_stock_quotes_stock_fetched` - Composite index for stock + fetch time queries

### 3. `stock_candles`
Stores OHLCV (Open, High, Low, Close, Volume) candlestick data.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each candle
- `stock_id` (INTEGER) - Foreign key to `stocks.id`
- `resolution` (TEXT) - Time resolution (1, 5, 15, 30, 60, D, W, M)
- `candle_timestamp` (BIGINT) - Unix timestamp of the candle
- `open_price` (DECIMAL) - Opening price
- `high_price` (DECIMAL) - Highest price
- `low_price` (DECIMAL) - Lowest price
- `close_price` (DECIMAL) - Closing price
- `volume` (BIGINT) - Trading volume
- `created_at` (TIMESTAMP) - When the record was created

**Constraints:**
- FOREIGN KEY `stock_id` REFERENCES `stocks(id)` ON DELETE CASCADE
- UNIQUE(stock_id, resolution, candle_timestamp) - Prevents duplicate candles

**Indexes:**
- `idx_stock_candles_stock_id` - For filtering by stock
- `idx_stock_candles_resolution` - For filtering by resolution
- `idx_stock_candles_timestamp` - For sorting by timestamp
- `idx_stock_candles_stock_resolution_timestamp` - Composite index for complex queries

### 4. `company_news`
Stores company-specific news articles.

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each article
- `stock_id` (INTEGER) - Foreign key to `stocks.id`
- `headline` (TEXT) - Article headline
- `summary` (TEXT) - Article summary
- `url` (TEXT) - Article URL (unique)
- `image_url` (TEXT) - URL to article image
- `source` (TEXT) - News source
- `published_at` (TIMESTAMP) - When the article was published
- `related_tickers` (TEXT[]) - Array of related ticker symbols
- `fetched_at` (TIMESTAMP) - When the article was fetched
- `created_at` (TIMESTAMP) - When the record was created
- `updated_at` (TIMESTAMP) - When the record was last updated

**Constraints:**
- FOREIGN KEY `stock_id` REFERENCES `stocks(id)` ON DELETE CASCADE
- UNIQUE(url) - Prevents duplicate articles

**Indexes:**
- `idx_company_news_stock_id` - For filtering by stock
- `idx_company_news_published_at` - For sorting by publication date
- `idx_company_news_created_at` - For sorting by insertion date
- `idx_company_news_url` - For fast URL lookups
- `idx_company_news_stock_published` - Composite index for stock + date queries

### 5. `market_news`
Stores general market news (not company-specific).

**Columns:**
- `id` (SERIAL PRIMARY KEY) - Unique identifier for each article
- `category` (TEXT) - News category (general, forex, crypto, merger)
- `headline` (TEXT) - Article headline
- `summary` (TEXT) - Article summary
- `url` (TEXT) - Article URL (unique)
- `image_url` (TEXT) - URL to article image
- `source` (TEXT) - News source
- `published_at` (TIMESTAMP) - When the article was published
- `related_tickers` (TEXT[]) - Array of related ticker symbols
- `fetched_at` (TIMESTAMP) - When the article was fetched
- `created_at` (TIMESTAMP) - When the record was created
- `updated_at` (TIMESTAMP) - When the record was last updated

**Constraints:**
- UNIQUE(url) - Prevents duplicate articles

**Indexes:**
- `idx_market_news_category` - For filtering by category
- `idx_market_news_published_at` - For sorting by publication date
- `idx_market_news_created_at` - For sorting by insertion date
- `idx_market_news_url` - For fast URL lookups
- `idx_market_news_category_published` - Composite index for category + date queries

## Relationships

```
stocks (1) ──< (many) stock_quotes
stocks (1) ──< (many) stock_candles
stocks (1) ──< (many) company_news
```

- Each stock can have many quotes (time series data)
- Each stock can have many candles (time series data)
- Each stock can have many news articles
- Market news is not tied to a specific stock
- Deleting a stock will cascade delete all associated quotes, candles, and news

## Usage Examples

### Get all active stocks
```sql
SELECT * FROM stocks WHERE is_active = true ORDER BY ticker;
```

### Get latest quote for a stock
```sql
SELECT q.*, s.ticker, s.name
FROM stock_quotes q
JOIN stocks s ON q.stock_id = s.id
WHERE s.ticker = 'AAPL'
ORDER BY q.fetched_at DESC
LIMIT 1;
```

### Get daily candles for a stock (last 30 days)
```sql
SELECT c.*, s.ticker
FROM stock_candles c
JOIN stocks s ON c.stock_id = s.id
WHERE s.ticker = 'AAPL'
  AND c.resolution = 'D'
  AND c.candle_timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days')
ORDER BY c.candle_timestamp DESC;
```

### Get latest company news
```sql
SELECT n.*, s.ticker, s.name
FROM company_news n
JOIN stocks s ON n.stock_id = s.id
WHERE s.ticker = 'AAPL'
ORDER BY n.published_at DESC
LIMIT 10;
```

### Get latest market news by category
```sql
SELECT *
FROM market_news
WHERE category = 'general'
ORDER BY published_at DESC
LIMIT 20;
```

### Get stock price history (quotes over time)
```sql
SELECT 
    DATE(to_timestamp(quote_timestamp)) as date,
    AVG(current_price) as avg_price,
    MAX(high_price) as max_price,
    MIN(low_price) as min_price
FROM stock_quotes
WHERE stock_id = (SELECT id FROM stocks WHERE ticker = 'AAPL')
  AND quote_timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
GROUP BY DATE(to_timestamp(quote_timestamp))
ORDER BY date DESC;
```

## Python Helper Functions

Use `markets_db_helper.py` to insert data:

```python
from markets_db_helper import get_supabase_client, sync_stock_data

# Sync data for a specific stock
supabase = get_supabase_client()
stats = sync_stock_data(supabase, 'AAPL', fetch_quotes=True, fetch_candles=True, fetch_news=True)
```

## Environment Variables Required

- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for server-side operations (keep secret!)
- `FINNHUB_API_KEY` - Your Finnhub API key

