-- ============================================================
-- 06_user_prefs.sql — User watchlist tables + RLS
--
-- Run order: 6  (requires 02_tables.sql)
-- ============================================================

-- Saved tickers (FK → info_agg.stocks, auth.users)
CREATE TABLE IF NOT EXISTS info_agg.watchlist_stocks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_id  uuid NOT NULL REFERENCES info_agg.stocks(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, stock_id)
);

-- Favorite leagues (FK → info_agg.leagues, auth.users)
CREATE TABLE IF NOT EXISTS info_agg.watchlist_leagues (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES info_agg.leagues(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id)
);

-- RLS: watchlist_stocks
ALTER TABLE info_agg.watchlist_stocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_stocks_select" ON info_agg.watchlist_stocks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "watchlist_stocks_insert" ON info_agg.watchlist_stocks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watchlist_stocks_update" ON info_agg.watchlist_stocks
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "watchlist_stocks_delete" ON info_agg.watchlist_stocks
  FOR DELETE USING (auth.uid() = user_id);

-- RLS: watchlist_leagues
ALTER TABLE info_agg.watchlist_leagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_leagues_select" ON info_agg.watchlist_leagues
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "watchlist_leagues_insert" ON info_agg.watchlist_leagues
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watchlist_leagues_update" ON info_agg.watchlist_leagues
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "watchlist_leagues_delete" ON info_agg.watchlist_leagues
  FOR DELETE USING (auth.uid() = user_id);
