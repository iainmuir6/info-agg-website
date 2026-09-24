-- ============================================================
-- 12_news_churn.sql — stop no-op rewrites bloating the news indexes
--
-- Every news feed re-fetches stories it already holds (Finnhub market news
-- every 15 min, NYT/ESPN hourly, the 7-day company-news lookback daily) and
-- upserts them on url. An upsert that changes nothing still writes a new row
-- version, and unless it lands HOT, a new entry in every index; the daily
-- retention delete then leaves those pages half-empty. Measured 2026-09-24:
-- market_news had 37k updates for 990 inserts and 6.9 MB of index over 1.8 MB
-- of rows; company_news 21 MB of index over 6 MB.
--
-- suppress_redundant_updates_trigger() (built into Postgres) skips an update
-- whose new row is byte-identical to the old one. A real edit (a corrected
-- NYT headline, a new thumbnail) still lands; only the no-ops go.
--
-- Named z_* because BEFORE triggers fire alphabetically and this must run
-- after any trigger that would modify the row. A suppressed row is absent
-- from RETURNING, which is why etl_lib.chunked_upsert asks for
-- return=minimal rather than counting the representation.
--
-- company_news itself is written insert-or-skip (ignore_duplicates) since
-- 057e1cd, so the trigger there only guards other writers.
--
-- Idempotent: safe to re-run.
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'market_news', 'company_news', 'news_articles', 'sports_news', 'news_sentiment'
    ] LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS z_suppress_redundant_updates ON info_agg.%I', t);
        EXECUTE format(
            'CREATE TRIGGER z_suppress_redundant_updates
                 BEFORE UPDATE ON info_agg.%I
                 FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger()', t);
    END LOOP;
END $$;

-- Never scanned: both company-news reads filter on related_tickers, not
-- stock_id. idx_company_news_stock_id stays — it backs the ON DELETE CASCADE
-- from stocks.
DROP INDEX IF EXISTS info_agg.idx_company_news_stock_published;
