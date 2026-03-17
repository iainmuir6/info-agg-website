-- ============================================================
-- 04_indexes.sql — Indexes for all info_agg tables
--
-- Run order: 4 of 4  (requires 02_tables.sql)
-- Author: IM / Scouts Consulting Group
--
-- Retained indexes only. Dropped indexes are in 05_prune.sql.
-- ============================================================


-- ── SPORTS — sports_news ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sports_news_league_id
    ON info_agg.sports_news (league_id);

CREATE INDEX IF NOT EXISTS idx_sports_news_published_at
    ON info_agg.sports_news (published_at DESC);


-- ── SPORTS — sports_scores ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sports_scores_league_id
    ON info_agg.sports_scores (league_id);

CREATE INDEX IF NOT EXISTS idx_sports_scores_game_date
    ON info_agg.sports_scores (game_date DESC);

CREATE INDEX IF NOT EXISTS idx_sports_scores_season
    ON info_agg.sports_scores (season DESC);

CREATE INDEX IF NOT EXISTS idx_sports_scores_league_date
    ON info_agg.sports_scores (league_id, game_date DESC);


-- ── MARKETS — stocks ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stocks_ticker
    ON info_agg.stocks (ticker);

CREATE INDEX IF NOT EXISTS idx_stocks_is_active
    ON info_agg.stocks (is_active);

CREATE INDEX IF NOT EXISTS idx_stocks_is_core
    ON info_agg.stocks (is_core);


-- ── MARKETS — stock_quotes ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stock_quotes_stock_id
    ON info_agg.stock_quotes (stock_id);


-- ── MARKETS — etf_holdings ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_etf_holdings_etf_stock_id
    ON info_agg.etf_holdings (etf_stock_id);

CREATE INDEX IF NOT EXISTS idx_etf_holdings_asset_stock_id
    ON info_agg.etf_holdings (asset_stock_id);


-- ── MARKETS — etf_sectors ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_etf_sectors_etf_stock_id
    ON info_agg.etf_sectors (etf_stock_id);


-- ── MARKETS — company_news ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_company_news_stock_id
    ON info_agg.company_news (stock_id);

CREATE INDEX IF NOT EXISTS idx_company_news_published_at
    ON info_agg.company_news (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_news_stock_published
    ON info_agg.company_news (stock_id, published_at DESC);


-- ── MARKETS — market_news ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_market_news_published_at
    ON info_agg.market_news (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_news_category_published
    ON info_agg.market_news (category, published_at DESC);


-- ── MARKETS — economic_indicators ───────────────────────────

CREATE INDEX IF NOT EXISTS idx_economic_indicators_name_date
    ON info_agg.economic_indicators (indicator_name, date DESC);


-- ── NEWS — news_articles ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_news_articles_source
    ON info_agg.news_articles (source);

CREATE INDEX IF NOT EXISTS idx_news_articles_published_at
    ON info_agg.news_articles (published_at DESC);


-- ── MEDIA — spotify_releases ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_spotify_releases_release_date
    ON info_agg.spotify_releases (release_date DESC);


-- ── MEDIA — reddit_posts ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_reddit_posts_score
    ON info_agg.reddit_posts (score DESC);


-- ── MARKETS — news_sentiment ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_news_sentiment_primary_ticker_id
    ON info_agg.news_sentiment (primary_ticker_id);
