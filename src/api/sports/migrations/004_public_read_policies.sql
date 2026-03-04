-- Public Read Policies for Sports Tables
-- Date: 2026-03-04
-- All sports data is publicly readable (no auth required)

ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Allow public read access to leagues"
    ON leagues FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Allow service role full access to leagues"
    ON leagues FOR ALL TO service_role USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to sports_news"
    ON sports_news FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Allow service role full access to sports_news"
    ON sports_news FOR ALL TO service_role USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to sports_scores"
    ON sports_scores FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Allow service role full access to sports_scores"
    ON sports_scores FOR ALL TO service_role USING (true);
