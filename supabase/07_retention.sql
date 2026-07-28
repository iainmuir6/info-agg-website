-- ============================================================
-- 07_retention.sql — Daily data-retention cleanup
--
-- Run order: 7  (idempotent, safe to re-run)
--
-- Defines info_agg.cleanup_daily(), which enforces the retention
-- policy and returns a jsonb report of rows deleted per table.
-- Invoke as the final step of the daily ETL workflow:
--     supabase.rpc('cleanup_daily')
-- or as a pg_cron backstop:
--     SELECT cron.schedule('cleanup', '0 6 * * *',
--                          $$SELECT info_agg.cleanup_daily()$$);
-- ============================================================

-- Re-add the quote_timestamp index (dropped in 05_prune.sql) so the
-- intraday collapse and history cap don't full-scan as the table grows
-- under the intraday refresh cadence. Write overhead is negligible at
-- this insert volume.
CREATE INDEX IF NOT EXISTS idx_stock_quotes_quote_timestamp
    ON info_agg.stock_quotes (quote_timestamp);

CREATE OR REPLACE FUNCTION info_agg.cleanup_daily(
    p_news_days          integer DEFAULT 7,   -- news_articles, company_news, market_news, sports_news, news_sentiment
    p_reddit_days        integer DEFAULT 3,   -- reddit_posts
    p_scores_days        integer DEFAULT 30,  -- sports_scores
    p_releases_days      integer DEFAULT 30,  -- spotify_releases
    p_quote_history_days integer DEFAULT 400, -- EOD stock_quotes history cap
    p_etl_runs_days      integer DEFAULT 90   -- etl_runs (skipped until the table exists)
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
    WHERE coalesce(published_at, fetched_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('news_sentiment', v_count);

    -- ── reddit_posts: hot posts go stale within hours ──
    DELETE FROM info_agg.reddit_posts
    WHERE coalesce(posted_at, fetched_at) < now() - make_interval(days => p_reddit_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('reddit_posts', v_count);

    -- ── sports_scores: keep recent history for team pages ──
    DELETE FROM info_agg.sports_scores
    WHERE game_date < now() - make_interval(days => p_scores_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('sports_scores', v_count);

    -- ── spotify_releases ──
    DELETE FROM info_agg.spotify_releases
    WHERE coalesce(release_date, fetched_at::date)
          < (now() - make_interval(days => p_releases_days))::date;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('spotify_releases', v_count);

    -- ── etl_runs: only once the observability table exists ──
    IF to_regclass('info_agg.etl_runs') IS NOT NULL THEN
        EXECUTE format(
            'DELETE FROM info_agg.etl_runs WHERE started_at < now() - make_interval(days => %s)',
            p_etl_runs_days
        );
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_report := v_report || jsonb_build_object('etl_runs', v_count);
    END IF;

    v_report := v_report || jsonb_build_object('ran_at', now());
    RETURN v_report;
END;
$$;

-- Only the ETL (service role) may run cleanup.
REVOKE ALL ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer) TO service_role;
