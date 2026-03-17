-- ============================================================
-- 02_tables.sql — Table definitions and seed data
--
-- Run order: 2 of 4  (requires 01_schema.sql)
-- Author: IM / Scouts Consulting Group
-- ============================================================


-- ============================================================
-- SPORTS — leagues
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.leagues (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport        TEXT    NOT NULL,
    league       TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (sport, league)
);

-- Initial league seed data
INSERT INTO info_agg.leagues (sport, league, display_name) VALUES
    ('football',   'nfl',                      'NFL'),
    ('football',   'college-football',          'College Football'),
    ('basketball', 'nba',                      'NBA'),
    ('basketball', 'wnba',                     'WNBA'),
    ('basketball', 'mens-college-basketball',  'Men''s College Basketball'),
    ('basketball', 'womens-college-basketball', 'Women''s College Basketball'),
    ('baseball',   'mlb',                      'MLB'),
    ('baseball',   'college-baseball',         'College Baseball'),
    ('hockey',     'nhl',                      'NHL'),
    ('soccer',     'eng.1',                    'English Premier League')
ON CONFLICT (sport, league) DO NOTHING;


-- ============================================================
-- SPORTS — sports_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.sports_news (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id    UUID    NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    description  TEXT,
    url          TEXT    NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE,
    source       TEXT    NOT NULL DEFAULT 'ESPN',
    image_url    TEXT,
    UNIQUE (url)
);


-- ============================================================
-- SPORTS — sports_scores
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.sports_scores (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id     UUID    NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
    event_id      TEXT    NOT NULL,
    home_team     TEXT    NOT NULL,
    away_team     TEXT    NOT NULL,
    home_score    INTEGER,
    away_score    INTEGER,
    home_record   TEXT,
    away_record   TEXT,
    status        TEXT,
    status_detail TEXT,
    game_date     TIMESTAMP WITH TIME ZONE,
    venue         TEXT,
    broadcast     TEXT,
    week          INTEGER,
    season        INTEGER,
    UNIQUE (league_id, event_id)
);


-- ============================================================
-- MARKETS — stocks
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.stocks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker            TEXT    NOT NULL UNIQUE,
    name              TEXT,
    country           TEXT,
    currency          TEXT,
    exchange          TEXT,
    ipo_date          DATE,
    market_cap        BIGINT,
    share_outstanding BIGINT,
    logo_url          TEXT,
    website           TEXT,
    industry          TEXT,
    sector            TEXT,
    description       TEXT,
    ceo               TEXT,
    city              TEXT,
    state             TEXT,
    beta              DECIMAL(8,4),
    asset_type        TEXT    NOT NULL DEFAULT 'stock',  -- 'stock' | 'etf' | 'crypto'
    is_core           BOOLEAN NOT NULL DEFAULT false,    -- true = in baskets.json watchlist
    is_active         BOOLEAN NOT NULL DEFAULT true
);


-- ============================================================
-- MARKETS — stock_quotes
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.stock_quotes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id        UUID    NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    current_price   DECIMAL(15, 4),
    change_amount   DECIMAL(15, 4),
    percent_change  DECIMAL(10, 4),
    high_price      DECIMAL(15, 4),
    low_price       DECIMAL(15, 4),
    open_price      DECIMAL(15, 4),
    previous_close  DECIMAL(15, 4),
    volume          BIGINT,
    quote_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    fetched_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (stock_id, quote_timestamp)
);


-- ============================================================
-- MARKETS — company_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.company_news (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id        UUID    NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    headline        TEXT    NOT NULL,
    summary         TEXT,
    url             TEXT    NOT NULL,
    image_url       TEXT,
    source          TEXT,
    published_at    TIMESTAMP WITH TIME ZONE,
    related_tickers TEXT[],
    fetched_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);


-- ============================================================
-- MARKETS — market_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.market_news (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category     TEXT NOT NULL,  -- general, forex, crypto, merger
    headline     TEXT NOT NULL,
    summary      TEXT,
    url          TEXT NOT NULL,
    image_url    TEXT,
    source       TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);


-- ============================================================
-- MARKETS — etf_holdings
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.etf_holdings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etf_stock_id   UUID    NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    asset_stock_id UUID    NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    asset_name     TEXT,
    weight_pct     DECIMAL(8,4),
    shares         BIGINT,
    market_value   DECIMAL(20,4),
    as_of_date     DATE,
    fetched_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (etf_stock_id, asset_stock_id, as_of_date)
);


-- ============================================================
-- MARKETS — etf_sectors
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.etf_sectors (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etf_stock_id UUID    NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    sector       TEXT    NOT NULL,
    weight_pct   DECIMAL(8,4),
    as_of_date   DATE,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (etf_stock_id, sector, as_of_date)
);


-- ============================================================
-- MARKETS — news_sentiment
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.news_sentiment (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                   TEXT NOT NULL,
    url                     TEXT NOT NULL UNIQUE,
    source                  TEXT,
    source_domain           TEXT,
    summary                 TEXT,
    banner_image            TEXT,
    published_at            TIMESTAMP WITH TIME ZONE,
    topics                  TEXT[],
    overall_sentiment_score DECIMAL(6,4),
    overall_sentiment_label TEXT,
    ticker_sentiments       JSONB,
    primary_ticker_id       UUID REFERENCES info_agg.stocks(id),
    fetched_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);


-- ============================================================
-- NEWS — news_articles
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.news_articles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source       TEXT NOT NULL,   -- 'nyt', 'newsapi'
    section      TEXT,            -- section / category
    title        TEXT NOT NULL,
    abstract     TEXT,
    byline       TEXT,
    url          TEXT NOT NULL,
    image_url    TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);


-- ============================================================
-- MEDIA — spotify_releases
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.spotify_releases (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spotify_id   TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    artists      TEXT[]  NOT NULL DEFAULT '{}',
    album_type   TEXT,              -- album, single, compilation
    release_date DATE,
    image_url    TEXT,
    external_url TEXT,
    total_tracks INTEGER,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (spotify_id)
);


-- ============================================================
-- MEDIA — reddit_posts
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.reddit_posts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       TEXT    NOT NULL,
    subreddit     TEXT    NOT NULL,
    title         TEXT    NOT NULL,
    author        TEXT,
    score         INTEGER NOT NULL DEFAULT 0,
    upvote_ratio  DECIMAL(5, 4),
    num_comments  INTEGER NOT NULL DEFAULT 0,
    url           TEXT,
    permalink     TEXT,
    selftext      TEXT,
    thumbnail_url TEXT,
    is_self       BOOLEAN NOT NULL DEFAULT FALSE,
    flair         TEXT,
    posted_at     TIMESTAMP WITH TIME ZONE,
    fetched_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (post_id)
);


-- ============================================================
-- MARKETS — economic_indicators
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.economic_indicators (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    indicator_name TEXT NOT NULL,   -- e.g. 'realGDP', 'treasury_10y'
    date           DATE NOT NULL,
    value          DECIMAL(20, 6),
    UNIQUE (indicator_name, date)
);
