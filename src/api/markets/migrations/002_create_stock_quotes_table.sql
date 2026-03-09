-- Create stock_quotes table
-- This table stores real-time quote data for stocks
CREATE TABLE IF NOT EXISTS info_agg.stock_quotes (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    current_price DECIMAL(15, 4),
    change_amount DECIMAL(15, 4),
    percent_change DECIMAL(10, 4),
    high_price DECIMAL(15, 4),
    low_price DECIMAL(15, 4),
    open_price DECIMAL(15, 4),
    previous_close DECIMAL(15, 4),
    quote_timestamp BIGINT,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_stock_quotes_stock_id ON info_agg.stock_quotes(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_quotes_fetched_at ON info_agg.stock_quotes(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_quotes_quote_timestamp ON info_agg.stock_quotes(quote_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_stock_quotes_stock_fetched ON info_agg.stock_quotes(stock_id, fetched_at DESC);

-- Create unique index to prevent duplicate quotes for the same stock at the same timestamp
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_quotes_stock_timestamp 
    ON info_agg.stock_quotes(stock_id, quote_timestamp);

