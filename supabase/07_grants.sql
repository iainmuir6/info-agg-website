-- ============================================================
-- 07_grants.sql — Write grants for user-owned tables
--
-- Run order: 7  (requires 06_user_prefs.sql)
--
-- 01_schema.sql's ALTER DEFAULT PRIVILEGES only grants SELECT to
-- `authenticated` for tables created afterward in this schema. The
-- watchlist_*/user_home_prefs tables rely on RLS policies to scope writes to
-- the owning user, but RLS is only evaluated after the base table privilege
-- check passes — without an explicit INSERT/UPDATE/DELETE grant here,
-- Postgres rejects every write before RLS runs, regardless of policy. This
-- was the root cause of favorited teams (and other watchlist rows) silently
-- failing to persist.
-- ============================================================

GRANT INSERT, UPDATE, DELETE ON info_agg.watchlist_stocks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON info_agg.watchlist_leagues TO authenticated;
GRANT INSERT, UPDATE, DELETE ON info_agg.watchlist_teams TO authenticated;
GRANT INSERT, UPDATE, DELETE ON info_agg.user_home_prefs TO authenticated;
