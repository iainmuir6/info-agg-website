-- ============================================================
-- 15_tracked_stocks.sql — user-added stocks the ETL quotes beyond baskets.json
--
-- The ETL quotes only src/api/markets/baskets.json. A signed-in user can add
-- any US ticker from /profile's Favorites search; the add path
-- (lib/tracked-stocks.ts, service role) validates it with Finnhub, creates the
-- stocks row and first quote, inserts a row here and favorites it. Both
-- orchestrators then quote baskets + tracked_stocks (run_etl.market_universe).
--
-- Rules, enforced here rather than only in app code:
--   * Global cap of 10 (TRACKED_STOCKS_CAP in lib/tracked-stocks.ts and
--     src/api/run_etl.py mirror it). Each tracked stock costs ~0.3-0.5s of the
--     daily run's 60s budget; see src/api/docs/RATE_LIMITS.md.
--   * Writes are service-role only: anon/authenticated get SELECT on
--     (stock_id, added_at) and nothing else, so the cap and the Finnhub
--     validation can't be bypassed and added_by is not public.
--   * Track + favorite is one transaction (track_and_favorite below), so an
--     add can't be raced by a removal or die holding a cap slot.
--   * Auto-untrack: removing the last watchlist_stocks favorite of a tracked,
--     non-basket (is_core = false) stock deletes its tracked_stocks row, so
--     the cap never fills with stocks nobody follows. The stocks row and its
--     quotes stay (like the other 3,000+ non-core rows).
--
-- Scoped to info_agg only. info_agg is already an exposed schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS info_agg.tracked_stocks (
    stock_id  UUID PRIMARY KEY REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
    added_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    added_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- FK column used by the ON DELETE SET NULL on auth.users.
CREATE INDEX IF NOT EXISTS idx_tracked_stocks_added_by
    ON info_agg.tracked_stocks (added_by);

ALTER TABLE info_agg.tracked_stocks ENABLE ROW LEVEL SECURITY;

-- Public like stocks itself: which tickers the site follows is not private.
DROP POLICY IF EXISTS "tracked_stocks: public read" ON info_agg.tracked_stocks;
CREATE POLICY "tracked_stocks: public read"
    ON info_agg.tracked_stocks FOR SELECT
    TO anon, authenticated
    USING (true);

-- 09 removed the default anon SELECT; RLS alone is not enough. Column-level:
-- added_by (who follows what) stays service-role only; /profile only counts.
REVOKE SELECT ON info_agg.tracked_stocks FROM anon, authenticated;
GRANT SELECT (stock_id, added_at) ON info_agg.tracked_stocks TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON info_agg.tracked_stocks FROM anon, authenticated;
GRANT ALL ON info_agg.tracked_stocks TO service_role;

-- ── Cap: at most 10 rows, race-proof ─────────────────────────────────────────
-- The transaction-scoped advisory lock serialises concurrent adds, so two
-- users adding the 10th and 11th stock at once can't both pass the count.
-- A row that already exists is let through so INSERT ... ON CONFLICT DO
-- NOTHING on a tracked stock stays a no-op at the cap instead of an error.
CREATE OR REPLACE FUNCTION info_agg.enforce_tracked_stocks_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    cap CONSTANT integer := 10;  -- mirrors TRACKED_STOCKS_CAP
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('info_agg.tracked_stocks'));
    IF EXISTS (SELECT 1 FROM info_agg.tracked_stocks WHERE stock_id = NEW.stock_id) THEN
        RETURN NEW;
    END IF;
    IF (SELECT count(*) FROM info_agg.tracked_stocks) >= cap THEN
        RAISE EXCEPTION 'tracked_stocks cap reached (%)', cap
            USING ERRCODE = 'P0001', HINT = 'tracked_stocks_cap';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tracked_stocks_cap ON info_agg.tracked_stocks;
CREATE TRIGGER tracked_stocks_cap
    BEFORE INSERT ON info_agg.tracked_stocks
    FOR EACH ROW EXECUTE FUNCTION info_agg.enforce_tracked_stocks_cap();

REVOKE ALL ON FUNCTION info_agg.enforce_tracked_stocks_cap() FROM PUBLIC, anon, authenticated;

-- ── Auto-untrack when the last favorite goes ─────────────────────────────────
-- SECURITY DEFINER because the deleting user can neither see other users'
-- watchlist rows (RLS) nor delete from tracked_stocks (no grant). It only ever
-- deletes the one tracked row for OLD.stock_id, and only when nobody else
-- favorites it and it isn't a basket (is_core) stock. Runs on user deletion
-- too (auth.users cascade into watchlist_stocks).
CREATE OR REPLACE FUNCTION info_agg.untrack_unfavorited_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Same lock as the cap and track_and_favorite, which writes the tracked
    -- row and the favorite in one transaction under it: a removal either
    -- runs first (the add then re-inserts the tracked row) or waits and sees
    -- the new favorite.
    PERFORM pg_advisory_xact_lock(hashtext('info_agg.tracked_stocks'));
    DELETE FROM info_agg.tracked_stocks t
     WHERE t.stock_id = OLD.stock_id
       AND NOT EXISTS (
             SELECT 1 FROM info_agg.watchlist_stocks w
              WHERE w.stock_id = OLD.stock_id)
       AND NOT EXISTS (
             SELECT 1 FROM info_agg.stocks s
              WHERE s.id = OLD.stock_id AND s.is_core);
    RETURN NULL;
END;
$$;

-- The NOT EXISTS above looks up by stock_id alone; the only existing index
-- leads with user_id.
CREATE INDEX IF NOT EXISTS idx_watchlist_stocks_stock_id
    ON info_agg.watchlist_stocks (stock_id);

DROP TRIGGER IF EXISTS watchlist_stocks_untrack ON info_agg.watchlist_stocks;
CREATE TRIGGER watchlist_stocks_untrack
    AFTER DELETE ON info_agg.watchlist_stocks
    FOR EACH ROW EXECUTE FUNCTION info_agg.untrack_unfavorited_stock();

REVOKE ALL ON FUNCTION info_agg.untrack_unfavorited_stock() FROM PUBLIC, anon, authenticated;

-- ── Track + favorite in one transaction ───────────────────────────────────────
-- The add path (lib/tracked-stocks.ts) calls this with the service role after
-- validating the symbol and upserting its stocks row. Holding the lock across
-- both inserts closes the gap a removal could slip into; the cap trigger still
-- applies (advisory locks are re-entrant within a session). Returns the
-- tracked count.
CREATE OR REPLACE FUNCTION info_agg.track_and_favorite(p_stock uuid, p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    n integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('info_agg.tracked_stocks'));
    INSERT INTO info_agg.tracked_stocks (stock_id, added_by)
        VALUES (p_stock, p_user)
        ON CONFLICT (stock_id) DO NOTHING;
    INSERT INTO info_agg.watchlist_stocks (user_id, stock_id)
        VALUES (p_user, p_stock)
        ON CONFLICT (user_id, stock_id) DO NOTHING;
    SELECT count(*) INTO n FROM info_agg.tracked_stocks;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION info_agg.track_and_favorite(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION info_agg.track_and_favorite(uuid, uuid) TO service_role;

-- ── House rule: wrap auth.uid() in a subquery (06 didn't) ────────────────────
-- Evaluated once per statement (InitPlan) instead of once per row.
DROP POLICY IF EXISTS watchlist_stocks_select ON info_agg.watchlist_stocks;
CREATE POLICY watchlist_stocks_select ON info_agg.watchlist_stocks
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS watchlist_stocks_insert ON info_agg.watchlist_stocks;
CREATE POLICY watchlist_stocks_insert ON info_agg.watchlist_stocks
    FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS watchlist_stocks_update ON info_agg.watchlist_stocks;
CREATE POLICY watchlist_stocks_update ON info_agg.watchlist_stocks
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS watchlist_stocks_delete ON info_agg.watchlist_stocks;
CREATE POLICY watchlist_stocks_delete ON info_agg.watchlist_stocks
    FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
