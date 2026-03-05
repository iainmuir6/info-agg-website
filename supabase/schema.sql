-- ============================================================
-- INFO AGG — MASTER SCHEMA MIGRATION
-- Run this once in the Supabase SQL Editor to create all tables.
-- Author: IM / Scouts Consulting Group
-- Date: 2026-03-05
-- ============================================================

-- Create the info_agg schema
CREATE SCHEMA IF NOT EXISTS info_agg;

-- Expose the schema through PostgREST so the Supabase client can reach it.
-- Replace 'anon' and 'authenticated' grants if you use different roles.
GRANT USAGE ON SCHEMA info_agg TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT ALL ON SEQUENCES TO service_role;

-- ============================================================
-- SHARED TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION info_agg.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- SPORTS — leagues
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.leagues (
    id SERIAL PRIMARY KEY,
    sport TEXT NOT NULL,
    league TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sport, league)
);

CREATE INDEX IF NOT EXISTS idx_leagues_sport_league ON info_agg.leagues(sport, league);
CREATE INDEX IF NOT EXISTS idx_leagues_is_active    ON info_agg.leagues(is_active);

INSERT INTO info_agg.leagues (sport, league, display_name) VALUES
    ('football',   'nfl',                     'NFL'),
    ('football',   'college-football',         'College Football'),
    ('basketball', 'nba',                     'NBA'),
    ('basketball', 'wnba',                    'WNBA'),
    ('basketball', 'mens-college-basketball', 'Men''s College Basketball'),
    ('basketball', 'womens-college-basketball','Women''s College Basketball'),
    ('baseball',   'mlb',                     'MLB'),
    ('baseball',   'college-baseball',        'College Baseball'),
    ('hockey',     'nhl',                     'NHL'),
    ('soccer',     'eng.1',                   'English Premier League')
ON CONFLICT (sport, league) DO NOTHING;

CREATE TRIGGER update_leagues_updated_at
    BEFORE UPDATE ON info_agg.leagues
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_updated_at_column();

ALTER TABLE info_agg.leagues ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to leagues"
    ON info_agg.leagues FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to leagues"
    ON info_agg.leagues FOR ALL TO service_role USING (true);


-- ============================================================
-- SPORTS — sports_news
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_sports_news_league_id   ON info_agg.sports_news(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_news_published_at ON info_agg.sports_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_news_created_at  ON info_agg.sports_news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_news_url         ON info_agg.sports_news(url);

CREATE TRIGGER update_sports_news_updated_at
    BEFORE UPDATE ON info_agg.sports_news
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_updated_at_column();

ALTER TABLE info_agg.sports_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to sports_news"
    ON info_agg.sports_news FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to sports_news"
    ON info_agg.sports_news FOR ALL TO service_role USING (true);


-- ============================================================
-- SPORTS — sports_scores
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.sports_scores (
    id SERIAL PRIMARY KEY,
    league_id INTEGER NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    home_record TEXT,
    away_record TEXT,
    status TEXT,
    status_detail TEXT,
    game_date TIMESTAMP WITH TIME ZONE,
    venue TEXT,
    broadcast TEXT,
    week INTEGER,
    season INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_scores_league_id   ON info_agg.sports_scores(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_scores_event_id    ON info_agg.sports_scores(event_id);
CREATE INDEX IF NOT EXISTS idx_sports_scores_game_date   ON info_agg.sports_scores(game_date DESC);
CREATE INDEX IF NOT EXISTS idx_sports_scores_season      ON info_agg.sports_scores(season DESC);
CREATE INDEX IF NOT EXISTS idx_sports_scores_status      ON info_agg.sports_scores(status);
CREATE INDEX IF NOT EXISTS idx_sports_scores_league_date ON info_agg.sports_scores(league_id, game_date DESC);

CREATE TRIGGER update_sports_scores_updated_at
    BEFORE UPDATE ON info_agg.sports_scores
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_updated_at_column();

ALTER TABLE info_agg.sports_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to sports_scores"
    ON info_agg.sports_scores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to sports_scores"
    ON info_agg.sports_scores FOR ALL TO service_role USING (true);


-- ============================================================
-- MARKETS — stocks
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_stocks_ticker    ON info_agg.stocks(ticker);
CREATE INDEX IF NOT EXISTS idx_stocks_exchange  ON info_agg.stocks(exchange);
CREATE INDEX IF NOT EXISTS idx_stocks_industry  ON info_agg.stocks(industry);
CREATE INDEX IF NOT EXISTS idx_stocks_is_active ON info_agg.stocks(is_active);

CREATE TRIGGER update_stocks_updated_at
    BEFORE UPDATE ON info_agg.stocks
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_updated_at_column();

ALTER TABLE info_agg.stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to stocks"
    ON info_agg.stocks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to stocks"
    ON info_agg.stocks FOR ALL TO service_role USING (true);


-- ============================================================
-- MARKETS — stock_quotes
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_stock_quotes_stock_id        ON info_agg.stock_quotes(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_quotes_fetched_at      ON info_agg.stock_quotes(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_quotes_quote_timestamp ON info_agg.stock_quotes(quote_timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_quotes_stock_timestamp
    ON info_agg.stock_quotes(stock_id, quote_timestamp);

ALTER TABLE info_agg.stock_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to stock_quotes"
    ON info_agg.stock_quotes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to stock_quotes"
    ON info_agg.stock_quotes FOR ALL TO service_role USING (true);


-- ============================================================
-- MARKETS — stock_candles
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.stock_candles (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    resolution TEXT NOT NULL,
    candle_timestamp BIGINT NOT NULL,
    open_price DECIMAL(15, 4) NOT NULL,
    high_price DECIMAL(15, 4) NOT NULL,
    low_price DECIMAL(15, 4) NOT NULL,
    close_price DECIMAL(15, 4) NOT NULL,
    volume BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_candles_stock_id   ON info_agg.stock_candles(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_candles_resolution ON info_agg.stock_candles(resolution);
CREATE INDEX IF NOT EXISTS idx_stock_candles_timestamp  ON info_agg.stock_candles(candle_timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_candles_stock_resolution_timestamp_unique
    ON info_agg.stock_candles(stock_id, resolution, candle_timestamp);

ALTER TABLE info_agg.stock_candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to stock_candles"
    ON info_agg.stock_candles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to stock_candles"
    ON info_agg.stock_candles FOR ALL TO service_role USING (true);


-- ============================================================
-- MARKETS — company_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.company_news (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    headline TEXT NOT NULL,
    summary TEXT,
    url TEXT NOT NULL,
    image_url TEXT,
    source TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    related_tickers TEXT[],
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(url)
);

CREATE INDEX IF NOT EXISTS idx_company_news_stock_id        ON info_agg.company_news(stock_id);
CREATE INDEX IF NOT EXISTS idx_company_news_published_at    ON info_agg.company_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_news_created_at      ON info_agg.company_news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_news_stock_published ON info_agg.company_news(stock_id, published_at DESC);

CREATE TRIGGER update_company_news_updated_at
    BEFORE UPDATE ON info_agg.company_news
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_updated_at_column();

ALTER TABLE info_agg.company_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to company_news"
    ON info_agg.company_news FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to company_news"
    ON info_agg.company_news FOR ALL TO service_role USING (true);


-- ============================================================
-- MARKETS — market_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.market_news (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT,
    url TEXT NOT NULL,
    image_url TEXT,
    source TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    related_tickers TEXT[],
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(url)
);

CREATE INDEX IF NOT EXISTS idx_market_news_category          ON info_agg.market_news(category);
CREATE INDEX IF NOT EXISTS idx_market_news_published_at      ON info_agg.market_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_news_category_published ON info_agg.market_news(category, published_at DESC);

CREATE TRIGGER update_market_news_updated_at
    BEFORE UPDATE ON info_agg.market_news
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_updated_at_column();

ALTER TABLE info_agg.market_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read access to market_news"
    ON info_agg.market_news FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to market_news"
    ON info_agg.market_news FOR ALL TO service_role USING (true);


-- ============================================================
-- NEWS — news_articles
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.news_articles (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    section TEXT,
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

CREATE INDEX IF NOT EXISTS idx_news_articles_source         ON info_agg.news_articles(source);
CREATE INDEX IF NOT EXISTS idx_news_articles_section        ON info_agg.news_articles(section);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at   ON info_agg.news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_created_at     ON info_agg.news_articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_source_section ON info_agg.news_articles(source, section);
CREATE INDEX IF NOT EXISTS idx_news_articles_source_published ON info_agg.news_articles(source, published_at DESC);

CREATE OR REPLACE FUNCTION info_agg.update_news_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_news_articles_updated_at
    BEFORE UPDATE ON info_agg.news_articles
    FOR EACH ROW EXECUTE FUNCTION info_agg.update_news_articles_updated_at();

ALTER TABLE info_agg.news_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to news_articles"
    ON info_agg.news_articles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow service role full access to news_articles"
    ON info_agg.news_articles FOR ALL TO service_role USING (true);


-- ============================================================
-- MEDIA — spotify_releases
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.spotify_releases (
    id SERIAL PRIMARY KEY,
    spotify_id TEXT NOT NULL,
    name TEXT NOT NULL,
    artists TEXT[] NOT NULL DEFAULT '{}',
    album_type TEXT,
    release_date DATE,
    image_url TEXT,
    external_url TEXT,
    total_tracks INTEGER,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT spotify_releases_spotify_id_unique UNIQUE (spotify_id)
);

CREATE INDEX IF NOT EXISTS idx_spotify_releases_release_date ON info_agg.spotify_releases(release_date DESC);
CREATE INDEX IF NOT EXISTS idx_spotify_releases_album_type   ON info_agg.spotify_releases(album_type);
CREATE INDEX IF NOT EXISTS idx_spotify_releases_fetched_at   ON info_agg.spotify_releases(fetched_at DESC);

ALTER TABLE info_agg.spotify_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to spotify_releases"
    ON info_agg.spotify_releases FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow service role full access to spotify_releases"
    ON info_agg.spotify_releases FOR ALL TO service_role USING (true);


-- ============================================================
-- MEDIA — reddit_posts
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.reddit_posts (
    id SERIAL PRIMARY KEY,
    post_id TEXT NOT NULL,
    subreddit TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    score INTEGER DEFAULT 0,
    upvote_ratio DECIMAL(5, 4),
    num_comments INTEGER DEFAULT 0,
    url TEXT,
    permalink TEXT,
    selftext TEXT,
    thumbnail_url TEXT,
    is_self BOOLEAN DEFAULT FALSE,
    flair TEXT,
    posted_at TIMESTAMP WITH TIME ZONE,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT reddit_posts_post_id_unique UNIQUE (post_id)
);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_subreddit       ON info_agg.reddit_posts(subreddit);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_score           ON info_agg.reddit_posts(score DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_posted_at       ON info_agg.reddit_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_fetched_at      ON info_agg.reddit_posts(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_posts_subreddit_score ON info_agg.reddit_posts(subreddit, score DESC);

ALTER TABLE info_agg.reddit_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to reddit_posts"
    ON info_agg.reddit_posts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow service role full access to reddit_posts"
    ON info_agg.reddit_posts FOR ALL TO service_role USING (true);
