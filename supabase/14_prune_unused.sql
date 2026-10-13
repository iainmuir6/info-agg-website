-- 14_prune_unused.sql — drop four tables nothing reads (2026-10-13).
--
--   news_sentiment     Alpha Vantage NEWS_SENTIMENT went premium (~2026-10-06);
--                      no page, briefing or other schema ever read it.
--   etf_holdings       Written only by the manual etfdb.com Selenium scraper
--   etf_sectors          (retired with this migration); last rows 2026-03-13,
--                      no reader.
--   watchlist_leagues  Its UI was removed; 0 rows.
--
-- Checked first: no views, foreign keys or functions in any schema depend on
-- them except cleanup_daily(), which is recreated below without its
-- news_sentiment step. Idempotent.

-- cleanup_daily loses p_sentiment_days. Dropping a parameter changes the
-- signature, so drop the 6-arg form and recreate (CREATE OR REPLACE would add
-- an overload and make the no-arg rpc('cleanup_daily') call ambiguous).
DROP FUNCTION IF EXISTS info_agg.cleanup_daily(integer, integer, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION info_agg.cleanup_daily(
    p_news_days          integer DEFAULT 30,   -- news_articles, company_news, market_news, sports_news
    p_scores_days        integer DEFAULT NULL, -- sports_scores; NULL = keep everything
    p_youtube_days       integer DEFAULT 30,   -- youtube_videos
    p_quote_history_days integer DEFAULT 400,  -- EOD stock_quotes history cap
    p_etl_runs_days      integer DEFAULT 90    -- etl_runs
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = info_agg, pg_temp
AS $$
DECLARE
    v_report   jsonb  := '{}'::jsonb;
    v_count    bigint;
    v_ny_midnight timestamptz :=
        date_trunc('day', now() AT TIME ZONE 'America/New_York')
        AT TIME ZONE 'America/New_York';
BEGIN
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

    DELETE FROM info_agg.stock_quotes
    WHERE quote_timestamp < now() - make_interval(days => p_quote_history_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('stock_quotes_history', v_count);

    -- News tables prune on fetched_at: how long WE have held the story, not how
    -- old the story is. Keying on published_at deleted articles the ETL had just
    -- fetched and the site was still showing, purely because the publisher dated
    -- them earlier -- news_articles held rows published as far back as 2016 that
    -- were re-fetched and re-deleted every single day.
    DELETE FROM info_agg.news_articles
    WHERE coalesce(fetched_at, published_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('news_articles', v_count);

    DELETE FROM info_agg.company_news
    WHERE coalesce(fetched_at, published_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('company_news', v_count);

    DELETE FROM info_agg.market_news
    WHERE coalesce(fetched_at, published_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('market_news', v_count);

    DELETE FROM info_agg.sports_news
    WHERE coalesce(fetched_at, published_at) < now() - make_interval(days => p_news_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('sports_news', v_count);

    -- sports_scores: full retention by default; team pages compute season
    -- records from this table. Pass p_scores_days to prune on demand.
    IF p_scores_days IS NOT NULL THEN
        DELETE FROM info_agg.sports_scores
        WHERE game_date < now() - make_interval(days => p_scores_days);
        GET DIAGNOSTICS v_count = ROW_COUNT;
    ELSE
        v_count := 0;
    END IF;
    v_report := v_report || jsonb_build_object('sports_scores', v_count);

    DELETE FROM info_agg.youtube_videos
    WHERE fetched_at < now() - make_interval(days => p_youtube_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('youtube_videos', v_count);

    DELETE FROM info_agg.etl_runs
    WHERE started_at < now() - make_interval(days => p_etl_runs_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_report := v_report || jsonb_build_object('etl_runs', v_count);

    v_report := v_report || jsonb_build_object('ran_at', now());
    RETURN v_report;
END;
$$;

-- Same privileges as before: service_role only (the ETL), never anon/authenticated.
REVOKE ALL ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION info_agg.cleanup_daily(integer, integer, integer, integer, integer) TO service_role;

DROP TABLE IF EXISTS info_agg.news_sentiment;
DROP TABLE IF EXISTS info_agg.etf_holdings;
DROP TABLE IF EXISTS info_agg.etf_sectors;
DROP TABLE IF EXISTS info_agg.watchlist_leagues;
