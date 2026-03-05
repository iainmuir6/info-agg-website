-- Create market_news table
-- This table stores general market news (not company-specific)
CREATE TABLE IF NOT EXISTS info_agg.market_news (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,  -- general, forex, crypto, merger
    headline TEXT NOT NULL,
    summary TEXT,
    url TEXT NOT NULL,
    image_url TEXT,
    source TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    related_tickers TEXT[],  -- Array of related ticker symbols
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(url)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_market_news_category ON info_agg.market_news(category);
CREATE INDEX IF NOT EXISTS idx_market_news_published_at ON info_agg.market_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_news_created_at ON info_agg.market_news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_news_url ON info_agg.market_news(url);
CREATE INDEX IF NOT EXISTS idx_market_news_category_published ON info_agg.market_news(category, published_at DESC);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_market_news_updated_at
    BEFORE UPDATE ON info_agg.market_news
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

