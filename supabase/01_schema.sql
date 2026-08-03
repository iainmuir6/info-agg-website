-- ============================================================
-- 01_schema.sql — Schema, grants, and shared trigger functions
--
-- Run order: 1 of 4
-- Author: IM / Scouts Consulting Group
-- ============================================================

-- Create the dedicated schema
CREATE SCHEMA IF NOT EXISTS info_agg;

-- ============================================================
-- PostgREST visibility
-- Allows the Supabase JS/Python client to target this schema
-- via db: { schema: 'info_agg' } / ClientOptions(schema='info_agg')
-- ============================================================
GRANT USAGE ON SCHEMA info_agg TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT ALL ON SEQUENCES TO service_role;

-- ============================================================
-- Shared trigger function — updates updated_at on every write
-- ============================================================
CREATE OR REPLACE FUNCTION info_agg.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================
-- Daily data-retention cleanup
--
-- Enforces the retention policy and returns a jsonb report of
-- rows deleted per table. Invoked as the final step of the daily
-- ETL workflow via supabase.rpc('cleanup_daily'); can also be
-- scheduled in-database as a backstop:
--     SELECT cron.schedule('cleanup', '0 6 * * *',
--                          $c$SELECT info_agg.cleanup_daily()$c$);
-- Requires idx_stock_quotes_quote_timestamp (04_indexes.sql).
-- ============================================================
-- Signature note: adding a parameter to a plpgsql function creates an
-- *overload* rather than replacing it, which would make the no-arg
-- rpc('cleanup_daily') call ambiguous. The old 5-arg form is dropped first.
DROP FUNCTION IF EXISTS info_agg.cleanup_daily(integer, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION info_agg.cleanup_daily(
    p_news_days          integer DEFAULT 7,    -- news_articles, company_news, market_news, sports_news
    p_scores_days        integer DEFAULT NULL, -- sports_scores; NULL = keep everything (see below)
    p_youtube_days       integer DEFAULT 30,  -- youtube_videos
    p_quote_history_days integer DEFAULT 400, -- EOD stock_quotes history cap
    p_etl_runs_days      integer DEFAULT 90,  -- etl_runs
    -- news_sentiment is kept far longer than the other news tables: it is the
    -- only one with analytical value over time (scored sentiment per ticker),
    -- and at ~320 rows/day it is the largest single table by volume, so this
    -- is the one retention knob worth revisiting if the DB gets tight.
    p_sentiment_days     integer DEFAULT 365
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = info_agg, pg_temp
AS $$
DECLARE
    v_report   jsonb  := '{}'::jsonb;
    v_count    bigint;
    -- Midnight today in New York, as timestamptz: quotes before this
    -- belong to completed trading days and can be collapsed to EOD.
    v_ny_midnight timestamptz :=
        date_trunc('day', now() AT TIME ZONE 'America/New_York')
        AT TIME ZONE 'America/New_York';
BEGIN
    -- ── stock_quotes: collapse intraday rows → one EOD row per day ──
    -- For each (stock, NY-calendar-day) before today, keep only the
    -- latest quote_timestamp; the rest are intraday snapshots.
    DELETE FROM info_agg.stock_quotes q
    USING (
        SELECT stock_id,
               (quote_timestamp AT TIME ZONE 'America/New_York')::date AS day,
               MAX(quote_timestamp) AS keep_ts
        FROM info_agg.stock_quotes
        WHERE quote_timestamp < v_ny_midnight
        GROUP BY 1, 2
    ) keep
    WHERE q.stock_id = keep.stock_id
      AND (q.quote_timestamp AT TIME ZONE 'America/New_York')::date = keep.day
      AND q.quote_timestamp <> keep.keep_ts;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('stock_quotes_intraday', v_count);

    -- ── stock_quotes: cap EOD history ──
    DELETE FROM info_agg.stock_quotes
    WHERE quote_timestamp < now() - make_interval(days => p_quote_history_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('stock_quotes_history', v_count);

    -- ── news-type tables: drop stories older than p_news_days ──
    DELETE FROM info_agg.news_articles
    WHERE coalesce(published_at, fetched_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('news_articles', v_count);

    DELETE FROM info_agg.company_news
    WHERE coalesce(published_at, fetched_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('company_news', v_count);

    DELETE FROM info_agg.market_news
    WHERE coalesce(published_at, fetched_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('market_news', v_count);

    -- sports_news has no fetched_at/created_at column; null published_at rows
    -- are conservatively kept.
    DELETE FROM info_agg.sports_news
    WHERE published_at < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('sports_news', v_count);

    DELETE FROM info_agg.news_sentiment
    WHERE coalesce(published_at, fetched_at) < now() - make_interval(days => p_sentiment_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('news_sentiment', v_count);

    -- ── sports_scores: full retention by default ──
    -- Team pages compute season win/loss records from this table and the
    -- daily run walks 150 days of schedule into it, so a short window
    -- deleted the very history both were built to keep: a 30-day policy
    -- was destroying ~1,070 rows per run, truncating every team record to
    -- the last month. Rows are small and bounded by the real schedule, so
    -- the default is now to keep everything. Pass an explicit
    -- p_scores_days to prune on demand.
    IF p_scores_days IS NOT NULL THEN
        DELETE FROM info_agg.sports_scores
        WHERE game_date < now() - make_interval(days => p_scores_days);
        GET DIAGNOSTICS v_count = ROW_COUNT;
    ELSE
        v_count := 0;
    END IF;
    v_report := v_report || jsonb_build_object('sports_scores', v_count);

    -- ── youtube_videos ──
    DELETE FROM info_agg.youtube_videos
    WHERE fetched_at < now() - make_interval(days => p_youtube_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('youtube_videos', v_count);

    -- ── etl_runs ──
    DELETE FROM info_agg.etl_runs
    WHERE started_at < now() - make_interval(days => p_etl_runs_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('etl_runs', v_count);

    v_report := v_report || jsonb_build_object('ran_at', now());
    RETURN v_report;
END;
$$;

-- Only the ETL (service role) may run cleanup.
REVOKE ALL ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer) TO service_role;
