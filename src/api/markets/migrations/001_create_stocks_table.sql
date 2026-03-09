-- Create stocks table
-- This table stores company/symbol information
CREATE TABLE IF NOT EXISTS info_agg.stocks (
    id SERIAL PRIMARY KEY,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT,
    country TEXT,
    currency TEXT,
    exchange TEXT,
    ipo_date DATE,
    market_cap BIGINT,
    share_outstanding BIGINT,
    logo_url TEXT,
    website TEXT,
    industry TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON info_agg.stocks(ticker);
CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON info_agg.stocks(exchange);
CREATE INDEX IF NOT EXISTS idx_stocks_industry ON info_agg.stocks(industry);
CREATE INDEX IF NOT EXISTS idx_stocks_is_active ON info_agg.stocks(is_active);

-- Create function to update updated_at timestamp (if not already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_stocks_updated_at
    BEFORE UPDATE ON info_agg.stocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

