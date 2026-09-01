-- ============================================================
-- 11_ai_summaries.sql — the two AI briefing cards
--
-- "Summary of the Day" and "Summary of the Week" are generated once a day and
-- once a week by src/api/summary/, from rows the other ETL domains already
-- wrote, and stored as JSONB under kind='summary' with key 'day' or 'week'.
--
-- No new table: this is the same shape 10_misc_content.sql was built for — a
-- small, display-only payload, read whole, with nothing joining or filtering
-- inside it. Adding a table would mean a second RLS policy, a second grant,
-- and a second reader for no gain.
--
-- The payload shape is enforced in lib/ai-summary.ts, the way every other
-- misc_content kind is. `_summary_kind` inside the payload distinguishes the
-- two shapes (day has yesterday/today item lists; week has domain sections).
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 10_misc_content.sql pinned the allowed kinds in a CHECK, so a new one has to
-- be added here rather than just written. Named constraint, so this replaces
-- it cleanly instead of accumulating anonymous duplicates.
ALTER TABLE info_agg.misc_content
    DROP CONSTRAINT IF EXISTS misc_content_kind_check;

ALTER TABLE info_agg.misc_content
    ADD CONSTRAINT misc_content_kind_check CHECK (kind IN (
        'weather', 'holiday', 'wikipedia', 'onthisday',
        'country', 'word', 'fact',
        'summary'
    ));

-- RLS policy, index and GRANT SELECT are inherited from 10_misc_content.sql —
-- they are table-wide, not per-kind, so the new rows are readable already.
