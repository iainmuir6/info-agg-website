-- ============================================================
-- 05_prune.sql — Remove legacy user_role enum + 27 unused indexes
--
-- Run order: 5 of 5  (idempotent, safe to re-run)
-- Author: IM / Scouts Consulting Group
-- ============================================================

-- ── Drop legacy enum (replaced by public.app_role) ──────────
DROP TYPE IF EXISTS public.user_role CASCADE;


-- ── Drop indexes redundant with UNIQUE constraints ───────────
DROP INDEX IF EXISTS info_agg.idx_sports_news_url;
DROP INDEX IF EXISTS info_agg.idx_company_news_url;
DROP INDEX IF EXISTS info_agg.idx_market_news_url;


-- ── Drop fetched_at / created_at indexes (not in query path) ─
DROP INDEX IF EXISTS info_agg.idx_sports_news_created_at;
DROP INDEX IF EXISTS info_agg.idx_stock_quotes_fetched_at;
DROP INDEX IF EXISTS info_agg.idx_company_news_created_at;
DROP INDEX IF EXISTS info_agg.idx_market_news_created_at;
DROP INDEX IF EXISTS info_agg.idx_news_articles_created_at;
DROP INDEX IF EXISTS info_agg.idx_spotify_releases_fetched_at;
DROP INDEX IF EXISTS info_agg.idx_reddit_posts_fetched_at;
DROP INDEX IF EXISTS info_agg.idx_news_sentiment_fetched_at;


-- ── Drop tiny reference-table indexes (leagues has 10 rows) ──
DROP INDEX IF EXISTS info_agg.idx_leagues_sport_league;
DROP INDEX IF EXISTS info_agg.idx_leagues_is_active;


-- ── Drop unused filter indexes ───────────────────────────────
DROP INDEX IF EXISTS info_agg.idx_sports_scores_event_id;
DROP INDEX IF EXISTS info_agg.idx_sports_scores_status;
DROP INDEX IF EXISTS info_agg.idx_stock_quotes_quote_timestamp;
DROP INDEX IF EXISTS info_agg.idx_stocks_exchange;
DROP INDEX IF EXISTS info_agg.idx_stocks_industry;
DROP INDEX IF EXISTS info_agg.idx_market_news_category;
DROP INDEX IF EXISTS info_agg.idx_news_articles_section;
DROP INDEX IF EXISTS info_agg.idx_news_articles_source_section;
DROP INDEX IF EXISTS info_agg.idx_news_articles_source_published;
DROP INDEX IF EXISTS info_agg.idx_spotify_releases_album_type;
DROP INDEX IF EXISTS info_agg.idx_reddit_posts_subreddit;
DROP INDEX IF EXISTS info_agg.idx_reddit_posts_posted_at;
DROP INDEX IF EXISTS info_agg.idx_reddit_posts_subreddit_score;
DROP INDEX IF EXISTS info_agg.idx_news_sentiment_published_at;
DROP INDEX IF EXISTS info_agg.idx_news_sentiment_sentiment_label;
