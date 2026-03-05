-- News Tables Migration
-- Author: IM
-- Date: 2026-03-04
-- Description: Creates tables for storing NYT and NewsAPI article data

-- ============================================================
-- NEWS ARTICLES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.news_articles (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,                          -- 'nyt', 'newsapi'
    section TEXT,                                  -- nyt section (technology, business, sports, etc.) or newsapi category
    title TEXT NOT NULL,
    abstract TEXT,
    byline TEXT,
    url TEXT NOT NULL,
    image_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT news_articles_url_unique UNIQUE (url)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_news_articles_source ON info_agg.news_articles(source);
CREATE INDEX IF NOT EXISTS idx_news_articles_section ON info_agg.news_articles(section);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON info_agg.news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_created_at ON info_agg.news_articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_source_section ON info_agg.news_articles(source, section);
CREATE INDEX IF NOT EXISTS idx_news_articles_source_published ON info_agg.news_articles(source, published_at DESC);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_news_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_news_articles_updated_at
    BEFORE UPDATE ON info_agg.news_articles
    FOR EACH ROW
    EXECUTE FUNCTION update_news_articles_updated_at();

-- ============================================================
-- ENABLE ROW LEVEL SECURITY (public read, service role write)
-- ============================================================
ALTER TABLE info_agg.news_articles ENABLE ROW LEVEL SECURITY;

-- Public read: all data is visible to anyone (anon + authenticated)
CREATE POLICY "Allow public read access to news_articles"
    ON news_articles FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow service role full access to news_articles"
    ON news_articles FOR ALL
    TO service_role
    USING (true);
