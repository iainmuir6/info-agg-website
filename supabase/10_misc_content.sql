-- ============================================================
-- 10_misc_content.sql — the miscellaneous cards (weather, holidays,
-- Wikipedia, countries, word of the day, useless facts)
--
-- One table with a JSONB payload rather than six near-empty tables. These
-- feeds are small, display-only, and read whole: nothing joins them, nothing
-- filters inside them, and each has a completely different shape. The cost is
-- that Postgres cannot type-check the payload, so the shape contract lives in
-- two places instead: the `kind` CHECK below, and the discriminated union in
-- lib/misc-content.ts that every reader goes through.
--
-- `key` disambiguates rows within a kind: a city for weather, an index ('0',
-- '1', ...) for the kinds that store several rows a day (wikipedia, fact), and
-- '' for the singletons (word, holiday, onthisday, country-of-the-day). The
-- one non-content row is ('country', 'ranks'), an ETL-side cache of population
-- and area rankings — readers must exclude it, which lib/misc-content.ts does.
-- ============================================================

CREATE TABLE IF NOT EXISTS info_agg.misc_content (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        TEXT NOT NULL CONSTRAINT misc_content_kind_check CHECK (kind IN (
                    'weather', 'holiday', 'wikipedia', 'onthisday',
                    'country', 'word', 'fact'
                )),
    key         TEXT NOT NULL DEFAULT '',
    payload     JSONB NOT NULL,
    fetched_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (kind, key)
);

-- No updated_at trigger: every other table in 02_tables.sql tracks freshness
-- with fetched_at alone, and info_agg.set_updated_at() is declared in
-- 01_schema.sql but is not actually deployed to this project.

-- Every card reads "the rows of this kind, newest first".
CREATE INDEX IF NOT EXISTS idx_misc_content_kind_fetched
    ON info_agg.misc_content (kind, fetched_at DESC);

ALTER TABLE info_agg.misc_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "misc_content: anon read" ON info_agg.misc_content;
CREATE POLICY "misc_content: anon read"
    ON info_agg.misc_content FOR SELECT
    TO anon, authenticated
    USING (true);

-- 09_security_hardening.sql removed the schema-wide default
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT TO anon`, so a new public table
-- is unreadable until granted explicitly. RLS alone is not enough: Postgres
-- checks table privileges before policies run.
GRANT SELECT ON info_agg.misc_content TO anon, authenticated;
