-- ============================================================
-- 03_rls.sql — Row Level Security policies
--
-- Run order: 3 of 4  (requires 02_tables.sql)
-- Author: IM / Scouts Consulting Group
--
-- Design notes
-- ─────────────────────────────────────────────────────────────
-- 1. All data in this schema is publicly readable (no auth required).
--    Write access is restricted to the service_role, which Supabase
--    configures with BYPASSRLS — so no explicit service_role policy
--    is needed or created here.  Adding one would be redundant and
--    could cause Supabase's advisor to surface a false-positive.
--
-- 2. Re-evaluation guard (Supabase advisor: auth-rls-initplan)
--    Calling auth.uid(), auth.role(), or current_setting() directly
--    inside a USING / WITH CHECK expression causes PostgreSQL to
--    re-evaluate that function once per row, not once per query.
--    Wrap every such call in a sub-SELECT to ensure single evaluation:
--
--      ✗  USING (auth.uid() = owner_id)
--      ✓  USING ((SELECT auth.uid()) = owner_id)
--
--    The public-read policies below use USING (true) and therefore
--    do not trigger this warning.  Any future user-scoped policy
--    MUST follow the (SELECT ...) pattern shown above.
-- ============================================================


-- ── SPORTS ──────────────────────────────────────────────────

ALTER TABLE info_agg.leagues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.sports_news   ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.sports_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leagues: anon read"
    ON info_agg.leagues FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "sports_news: anon read"
    ON info_agg.sports_news FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "sports_scores: anon read"
    ON info_agg.sports_scores FOR SELECT
    TO anon, authenticated
    USING (true);


-- ── MARKETS ─────────────────────────────────────────────────

ALTER TABLE info_agg.stocks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.stock_quotes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.company_news  ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.market_news   ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.etf_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.etf_sectors   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stocks: anon read"
    ON info_agg.stocks FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "stock_quotes: anon read"
    ON info_agg.stock_quotes FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "company_news: anon read"
    ON info_agg.company_news FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "market_news: anon read"
    ON info_agg.market_news FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "etf_holdings: anon read"
    ON info_agg.etf_holdings FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "etf_sectors: anon read"
    ON info_agg.etf_sectors FOR SELECT
    TO anon, authenticated
    USING (true);


ALTER TABLE info_agg.news_sentiment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "news_sentiment: anon read"
    ON info_agg.news_sentiment FOR SELECT
    TO anon, authenticated
    USING (true);


ALTER TABLE info_agg.economic_indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "economic_indicators: anon read"
    ON info_agg.economic_indicators FOR SELECT
    TO anon, authenticated
    USING (true);


-- ── NEWS ────────────────────────────────────────────────────

ALTER TABLE info_agg.news_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "news_articles: anon read"
    ON info_agg.news_articles FOR SELECT
    TO anon, authenticated
    USING (true);


-- ── MEDIA ───────────────────────────────────────────────────

ALTER TABLE info_agg.spotify_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.reddit_posts     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spotify_releases: anon read"
    ON info_agg.spotify_releases FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "reddit_posts: anon read"
    ON info_agg.reddit_posts FOR SELECT
    TO anon, authenticated
    USING (true);
