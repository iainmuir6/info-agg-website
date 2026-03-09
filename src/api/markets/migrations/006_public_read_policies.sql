-- Public Read Policies for Markets Tables
-- Date: 2026-03-04
-- All markets data is publicly readable (no auth required)

ALTER TABLE info_agg.stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.stock_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.stock_candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.company_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_agg.market_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Allow public read access to stocks"
    ON stocks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to stocks"
    ON stocks FOR ALL TO service_role USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to stock_quotes"
    ON stock_quotes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to stock_quotes"
    ON stock_quotes FOR ALL TO service_role USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to stock_candles"
    ON stock_candles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to stock_candles"
    ON stock_candles FOR ALL TO service_role USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to company_news"
    ON company_news FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to company_news"
    ON company_news FOR ALL TO service_role USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to market_news"
    ON market_news FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service role full access to market_news"
    ON market_news FOR ALL TO service_role USING (true);
