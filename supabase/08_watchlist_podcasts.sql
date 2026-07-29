-- ============================================================
-- 08_watchlist_podcasts.sql — Favorite podcasts
--
-- Run order: 8  (requires 02_tables.sql)
--
-- Podcasts aren't in a curated table like teams/leagues/stocks are (Spotify
-- has no discovery endpoint we sync — see lib/top-podcasts.ts) — a favorite
-- can be any show a user finds via the search API, so this stores enough of
-- the Spotify show object (name, image) to render the row without a lookup.
--
-- Per the watchlist_teams incident: RLS policies alone are not sufficient —
-- Postgres checks table-level privileges before RLS runs, so the explicit
-- GRANT below is included from day one instead of being a follow-up fix.
-- ============================================================

CREATE TABLE IF NOT EXISTS info_agg.watchlist_podcasts (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id   text NOT NULL,
  name      text NOT NULL,
  image_url text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, show_id)
);

ALTER TABLE info_agg.watchlist_podcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_podcasts_select" ON info_agg.watchlist_podcasts
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "watchlist_podcasts_insert" ON info_agg.watchlist_podcasts
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "watchlist_podcasts_delete" ON info_agg.watchlist_podcasts
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

GRANT INSERT, DELETE ON info_agg.watchlist_podcasts TO authenticated;
