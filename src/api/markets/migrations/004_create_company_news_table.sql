-- Create company_news table
-- This table stores company-specific news articles
CREATE TABLE IF NOT EXISTS info_agg.company_news (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_company_news_stock_id ON info_agg.company_news(stock_id);
CREATE INDEX IF NOT EXISTS idx_company_news_published_at ON info_agg.company_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_news_created_at ON info_agg.company_news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_news_url ON info_agg.company_news(url);
CREATE INDEX IF NOT EXISTS idx_company_news_stock_published ON info_agg.company_news(stock_id, published_at DESC);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_company_news_updated_at
    BEFORE UPDATE ON info_agg.company_news
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

