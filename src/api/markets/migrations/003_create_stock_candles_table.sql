-- Create stock_candles table
-- This table stores OHLCV (Open, High, Low, Close, Volume) candlestick data
CREATE TABLE IF NOT EXISTS info_agg.stock_candles (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    resolution TEXT NOT NULL,  -- 1, 5, 15, 30, 60, D, W, M
    candle_timestamp BIGINT NOT NULL,
    open_price DECIMAL(15, 4) NOT NULL,
    high_price DECIMAL(15, 4) NOT NULL,
    low_price DECIMAL(15, 4) NOT NULL,
    close_price DECIMAL(15, 4) NOT NULL,
    volume BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_stock_candles_stock_id ON info_agg.stock_candles(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_candles_resolution ON info_agg.stock_candles(resolution);
CREATE INDEX IF NOT EXISTS idx_stock_candles_timestamp ON info_agg.stock_candles(candle_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_stock_candles_stock_resolution_timestamp 
    ON info_agg.stock_candles(stock_id, resolution, candle_timestamp DESC);

-- Create unique index to prevent duplicate candles
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_candles_stock_resolution_timestamp_unique 
    ON info_agg.stock_candles(stock_id, resolution, candle_timestamp);

