-- ============================================================
-- 02_tables.sql — Table definitions, seed data, and triggers
--
-- Run order: 2 of 4  (requires 01_schema.sql)
-- Author: IM / Scouts Consulting Group
-- ============================================================


-- ============================================================
-- SPORTS — leagues
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.leagues (
    id           SERIAL PRIMARY KEY,
    sport        TEXT    NOT NULL,
    league       TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (sport, league)
);

CREATE TRIGGER trg_leagues_updated_at
    BEFORE UPDATE ON info_agg.leagues
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();

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
    id           SERIAL PRIMARY KEY,
    league_id    INTEGER NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    description  TEXT,
    url          TEXT    NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE,
    source       TEXT    NOT NULL DEFAULT 'ESPN',
    image_url    TEXT,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);

CREATE TRIGGER trg_sports_news_updated_at
    BEFORE UPDATE ON info_agg.sports_news
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();


-- ============================================================
-- SPORTS — sports_scores
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.sports_scores (
    id            SERIAL PRIMARY KEY,
    league_id     INTEGER NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
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
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (league_id, event_id)
);

CREATE TRIGGER trg_sports_scores_updated_at
    BEFORE UPDATE ON info_agg.sports_scores
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();


-- ============================================================
-- MARKETS — stocks
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.stocks (
    id                SERIAL PRIMARY KEY,
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
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_stocks_updated_at
    BEFORE UPDATE ON info_agg.stocks
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();


-- ============================================================
-- MARKETS — stock_quotes
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.stock_quotes (
    id              SERIAL PRIMARY KEY,
    stock_id        INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    current_price   DECIMAL(15, 4),
    change_amount   DECIMAL(15, 4),
    percent_change  DECIMAL(10, 4),
    high_price      DECIMAL(15, 4),
    low_price       DECIMAL(15, 4),
    open_price      DECIMAL(15, 4),
    previous_close  DECIMAL(15, 4),
    quote_timestamp BIGINT,
    fetched_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);


-- ============================================================
-- MARKETS — stock_candles
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.stock_candles (
    id               SERIAL PRIMARY KEY,
    stock_id         INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    resolution       TEXT    NOT NULL,  -- 1, 5, 15, 30, 60, D, W, M
    candle_timestamp BIGINT  NOT NULL,
    open_price       DECIMAL(15, 4) NOT NULL,
    high_price       DECIMAL(15, 4) NOT NULL,
    low_price        DECIMAL(15, 4) NOT NULL,
    close_price      DECIMAL(15, 4) NOT NULL,
    volume           BIGINT,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);


-- ============================================================
-- MARKETS — company_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.company_news (
    id              SERIAL PRIMARY KEY,
    stock_id        INTEGER NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    headline        TEXT    NOT NULL,
    summary         TEXT,
    url             TEXT    NOT NULL,
    image_url       TEXT,
    source          TEXT,
    published_at    TIMESTAMP WITH TIME ZONE,
    related_tickers TEXT[],
    fetched_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);

CREATE TRIGGER trg_company_news_updated_at
    BEFORE UPDATE ON info_agg.company_news
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();


-- ============================================================
-- MARKETS — market_news
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.market_news (
    id              SERIAL PRIMARY KEY,
    category        TEXT NOT NULL,  -- general, forex, crypto, merger
    headline        TEXT NOT NULL,
    summary         TEXT,
    url             TEXT NOT NULL,
    image_url       TEXT,
    source          TEXT,
    published_at    TIMESTAMP WITH TIME ZONE,
    related_tickers TEXT[],
    fetched_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);

CREATE TRIGGER trg_market_news_updated_at
    BEFORE UPDATE ON info_agg.market_news
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();


-- ============================================================
-- NEWS — news_articles
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.news_articles (
    id           SERIAL PRIMARY KEY,
    source       TEXT NOT NULL,   -- 'nyt', 'newsapi'
    section      TEXT,            -- section / category
    title        TEXT NOT NULL,
    abstract     TEXT,
    byline       TEXT,
    url          TEXT NOT NULL,
    image_url    TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (url)
);

CREATE TRIGGER trg_news_articles_updated_at
    BEFORE UPDATE ON info_agg.news_articles
    FOR EACH ROW EXECUTE FUNCTION info_agg.set_updated_at();


-- ============================================================
-- MEDIA — spotify_releases
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.spotify_releases (
    id           SERIAL PRIMARY KEY,
    spotify_id   TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    artists      TEXT[]  NOT NULL DEFAULT '{}',
    album_type   TEXT,              -- album, single, compilation
    release_date DATE,
    image_url    TEXT,
    external_url TEXT,
    total_tracks INTEGER,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (spotify_id)
);


-- ============================================================
-- MEDIA — reddit_posts
-- ============================================================
CREATE TABLE IF NOT EXISTS info_agg.reddit_posts (
    id           SERIAL PRIMARY KEY,
    post_id      TEXT    NOT NULL,
    subreddit    TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    author       TEXT,
    score        INTEGER NOT NULL DEFAULT 0,
    upvote_ratio DECIMAL(5, 4),
    num_comments INTEGER NOT NULL DEFAULT 0,
    url          TEXT,
    permalink    TEXT,
    selftext     TEXT,
    thumbnail_url TEXT,
    is_self      BOOLEAN NOT NULL DEFAULT FALSE,
    flair        TEXT,
    posted_at    TIMESTAMP WITH TIME ZONE,
    fetched_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (post_id)
);
