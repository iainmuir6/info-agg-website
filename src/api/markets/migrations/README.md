# Database Migrations

This directory contains SQL migration files for setting up the markets data database schema.

## Migration Files

1. **001_create_stocks_table.sql** - Creates the stocks table for company/symbol information
2. **002_create_stock_quotes_table.sql** - Creates the stock_quotes table for real-time quote data
3. **003_create_stock_candles_table.sql** - Creates the stock_candles table for OHLCV candlestick data
4. **004_create_company_news_table.sql** - Creates the company_news table for company-specific news
5. **005_create_market_news_table.sql** - Creates the market_news table for general market news

## Running Migrations

### Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run each migration file in order (001, 002, 003, 004, 005)

### Using Supabase CLI

```bash
# If you have Supabase CLI installed
supabase db push
```

### Using psql

```bash
# Connect to your Supabase database
psql -h <your-db-host> -U postgres -d postgres

# Run migrations in order
\i src/api/markets/migrations/001_create_stocks_table.sql
\i src/api/markets/migrations/002_create_stock_quotes_table.sql
\i src/api/markets/migrations/003_create_stock_candles_table.sql
\i src/api/markets/migrations/004_create_company_news_table.sql
\i src/api/markets/migrations/005_create_market_news_table.sql
```

## Schema Overview

### stocks
- Primary key: `id` (SERIAL)
- Unique constraint on `ticker`
- Stores company information including name, exchange, industry, market cap, etc.

### stock_quotes
- Primary key: `id` (SERIAL)
- Foreign key: `stock_id` → `stocks(id)`
- Unique constraint on `(stock_id, quote_timestamp)` to prevent duplicate quotes
- Stores real-time quote data (current price, change, high, low, open, previous close)

### stock_candles
- Primary key: `id` (SERIAL)
- Foreign key: `stock_id` → `stocks(id)`
- Unique constraint on `(stock_id, resolution, candle_timestamp)` to prevent duplicate candles
- Stores OHLCV (Open, High, Low, Close, Volume) data for various time resolutions

### company_news
- Primary key: `id` (SERIAL)
- Foreign key: `stock_id` → `stocks(id)`
- Unique constraint on `url` to prevent duplicate articles
- Stores company-specific news articles

### market_news
- Primary key: `id` (SERIAL)
- Unique constraint on `url` to prevent duplicate articles
- Stores general market news (not tied to a specific company)

## Notes

- All tables include `created_at` and `updated_at` timestamps where appropriate
- The `updated_at` timestamp is automatically updated via triggers
- Foreign keys use `ON DELETE CASCADE` to maintain referential integrity
- Indexes are created for common query patterns
- Stock quotes and candles use unique constraints to prevent duplicate data

