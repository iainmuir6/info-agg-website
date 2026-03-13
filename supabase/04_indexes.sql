-- ============================================================
-- 04_indexes.sql — Indexes for all info_agg tables
--
-- Run order: 4 of 4  (requires 02_tables.sql)
-- Author: IM / Scouts Consulting Group
-- ============================================================


-- ── SPORTS — leagues ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leagues_sport_league
    ON info_agg.leagues (sport, league);

CREATE INDEX IF NOT EXISTS idx_leagues_is_active
    ON info_agg.leagues (is_active);


-- ── SPORTS — sports_news ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sports_news_league_id
    ON info_agg.sports_news (league_id);

CREATE INDEX IF NOT EXISTS idx_sports_news_published_at
    ON info_agg.sports_news (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_sports_news_created_at
    ON info_agg.sports_news (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sports_news_url
    ON info_agg.sports_news (url);


-- ── SPORTS — sports_scores ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sports_scores_league_id
    ON info_agg.sports_scores (league_id);

CREATE INDEX IF NOT EXISTS idx_sports_scores_event_id
    ON info_agg.sports_scores (event_id);

CREATE INDEX IF NOT EXISTS idx_sports_scores_game_date
    ON info_agg.sports_scores (game_date DESC);

CREATE INDEX IF NOT EXISTS idx_sports_scores_season
    ON info_agg.sports_scores (season DESC);

CREATE INDEX IF NOT EXISTS idx_sports_scores_status
    ON info_agg.sports_scores (status);

CREATE INDEX IF NOT EXISTS idx_sports_scores_league_date
    ON info_agg.sports_scores (league_id, game_date DESC);


-- ── MARKETS — stocks ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stocks_ticker
    ON info_agg.stocks (ticker);

CREATE INDEX IF NOT EXISTS idx_stocks_exchange
    ON info_agg.stocks (exchange);

CREATE INDEX IF NOT EXISTS idx_stocks_industry
    ON info_agg.stocks (industry);

CREATE INDEX IF NOT EXISTS idx_stocks_is_active
    ON info_agg.stocks (is_active);


-- ── MARKETS — stock_quotes ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stock_quotes_stock_id
    ON info_agg.stock_quotes (stock_id);

CREATE INDEX IF NOT EXISTS idx_stock_quotes_fetched_at
    ON info_agg.stock_quotes (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_quotes_quote_timestamp
    ON info_agg.stock_quotes (quote_timestamp DESC);


-- ── MARKETS — etf_holdings ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_etf_holdings_etf_stock_id
    ON info_agg.etf_holdings (etf_stock_id);

CREATE INDEX IF NOT EXISTS idx_etf_holdings_asset_stock_id
    ON info_agg.etf_holdings (asset_stock_id);


-- ── MARKETS — etf_sectors ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_etf_sectors_etf_stock_id
    ON info_agg.etf_sectors (etf_stock_id);

CREATE INDEX IF NOT EXISTS idx_stocks_is_core
    ON info_agg.stocks (is_core);


-- ── MARKETS — company_news ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_company_news_stock_id
    ON info_agg.company_news (stock_id);

CREATE INDEX IF NOT EXISTS idx_company_news_published_at
    ON info_agg.company_news (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_news_created_at
    ON info_agg.company_news (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_news_url
    ON info_agg.company_news (url);

CREATE INDEX IF NOT EXISTS idx_company_news_stock_published
    ON info_agg.company_news (stock_id, published_at DESC);


-- ── MARKETS — market_news ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_market_news_category
    ON info_agg.market_news (category);

CREATE INDEX IF NOT EXISTS idx_market_news_published_at
    ON info_agg.market_news (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_news_created_at
    ON info_agg.market_news (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_news_url
    ON info_agg.market_news (url);

CREATE INDEX IF NOT EXISTS idx_market_news_category_published
    ON info_agg.market_news (category, published_at DESC);


-- ── MARKETS — news_sentiment ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_news_sentiment_published_at
    ON info_agg.news_sentiment (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_sentiment_sentiment_label
    ON info_agg.news_sentiment (overall_sentiment_label);

CREATE INDEX IF NOT EXISTS idx_news_sentiment_fetched_at
    ON info_agg.news_sentiment (fetched_at DESC);


-- ── NEWS — news_articles ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_news_articles_source
    ON info_agg.news_articles (source);

CREATE INDEX IF NOT EXISTS idx_news_articles_section
    ON info_agg.news_articles (section);

CREATE INDEX IF NOT EXISTS idx_news_articles_published_at
    ON info_agg.news_articles (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_created_at
    ON info_agg.news_articles (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_source_section
    ON info_agg.news_articles (source, section);

CREATE INDEX IF NOT EXISTS idx_news_articles_source_published
    ON info_agg.news_articles (source, published_at DESC);


-- ── MEDIA — spotify_releases ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_spotify_releases_release_date
    ON info_agg.spotify_releases (release_date DESC);

CREATE INDEX IF NOT EXISTS idx_spotify_releases_album_type
    ON info_agg.spotify_releases (album_type);

CREATE INDEX IF NOT EXISTS idx_spotify_releases_fetched_at
    ON info_agg.spotify_releases (fetched_at DESC);


-- ── MEDIA — reddit_posts ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_reddit_posts_subreddit
    ON info_agg.reddit_posts (subreddit);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_score
    ON info_agg.reddit_posts (score DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_posted_at
    ON info_agg.reddit_posts (posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_fetched_at
    ON info_agg.reddit_posts (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_posts_subreddit_score
    ON info_agg.reddit_posts (subreddit, score DESC);
