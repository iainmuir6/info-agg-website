-- Create sports_news table
-- This table stores news articles for each league
CREATE TABLE IF NOT EXISTS info_agg.sports_news (
    id SERIAL PRIMARY KEY,
    league_id INTEGER NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE,
    source TEXT DEFAULT 'ESPN',
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(url)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sports_news_league_id ON info_agg.sports_news(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_news_published_at ON info_agg.sports_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_news_created_at ON info_agg.sports_news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_news_url ON info_agg.sports_news(url);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_sports_news_updated_at
    BEFORE UPDATE ON info_agg.sports_news
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

