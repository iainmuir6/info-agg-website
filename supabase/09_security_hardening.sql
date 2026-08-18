-- ============================================================
-- 09_security_hardening.sql — PROPOSED, NOT YET APPLIED
--
-- Run order: 9  (requires 01–08)
-- Fixes found by the anon-access audit of 2026-08-17.
--
-- Every statement is idempotent. Sections A–D are info_agg-only and safe
-- to run as a unit; section E touches OTHER apps sharing this project and
-- should be applied only after those apps are re-tested.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- A. Scrub API keys already leaked into etl_runs
--
-- requests' exception strings include the full request URL, query string
-- and all. Finnhub (and any other fetcher that authenticates via a query
-- param) therefore wrote live API keys into etl_runs.errors / .stats,
-- which anon can read. Redact the historical rows here; section A2 of the
-- companion patch to src/api/etl_lib.py stops new ones being written.
--
-- The keys themselves must ALSO be rotated — redacting the table does not
-- un-disclose a key that has been publicly readable since 2026-08-03.
-- ────────────────────────────────────────────────────────────
UPDATE info_agg.etl_runs
SET errors = regexp_replace(
        errors::text,
        '((?:token|apikey|api_key|api-key|key)=)[A-Za-z0-9_-]{8,}',
        '\1[REDACTED]', 'gi')::jsonb,
    stats = regexp_replace(
        stats::text,
        '((?:token|apikey|api_key|api-key|key)=)[A-Za-z0-9_-]{8,}',
        '\1[REDACTED]', 'gi')::jsonb
WHERE coalesce(errors::text, '') || coalesce(stats::text, '')
      ~* '(token|apikey|api_key|api-key|key)=[A-Za-z0-9_-]{8,}';


-- ────────────────────────────────────────────────────────────
-- B. etl_runs: anon sees freshness, only super_admins see the payload
--
-- The public header health dot (app/(public)/layout.tsx, via the cookieless
-- createStaticClient) needs exactly three columns: status, started_at,
-- finished_at. stats / errors / cleanup / triggered_by / tier are internal
-- operational detail and are what leaked the keys above.
--
-- Column-level grants are used rather than a view: PostgREST honours them,
-- no SECURITY DEFINER object is introduced, and `select=*` as anon simply
-- fails instead of silently widening later.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "etl_runs: anon read" ON info_agg.etl_runs;

CREATE POLICY "etl_runs: anon health read"
    ON info_agg.etl_runs FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "etl_runs: super_admin read" ON info_agg.etl_runs;
CREATE POLICY "etl_runs: super_admin read"
    ON info_agg.etl_runs FOR SELECT
    TO authenticated
    USING ((SELECT public.is_super_admin()));

REVOKE SELECT ON info_agg.etl_runs FROM anon, authenticated;
GRANT  SELECT (status, started_at, finished_at) ON info_agg.etl_runs TO anon;
GRANT  SELECT ON info_agg.etl_runs TO authenticated;   -- rows filtered by RLS above


-- ────────────────────────────────────────────────────────────
-- C. User-owned tables: drop the pointless anon SELECT grant
--
-- RLS already returns zero rows to anon (auth.uid() IS NULL), so this is
-- defence in depth, not a live hole — but it removes the single-mistake
-- failure mode where dropping or loosening one policy exposes every user's
-- watchlist. Also drops UPDATE grants on the two tables that have no
-- UPDATE policy, so the privilege and the policy set agree.
-- ────────────────────────────────────────────────────────────
REVOKE SELECT ON info_agg.watchlist_stocks   FROM anon;
REVOKE SELECT ON info_agg.watchlist_leagues  FROM anon;
REVOKE SELECT ON info_agg.watchlist_teams    FROM anon;
REVOKE SELECT ON info_agg.watchlist_podcasts FROM anon;
REVOKE SELECT ON info_agg.user_home_prefs    FROM anon;

REVOKE UPDATE ON info_agg.watchlist_teams    FROM authenticated;  -- no UPDATE policy exists


-- ────────────────────────────────────────────────────────────
-- D. Stop new info_agg tables from being anon-readable by default
--
-- 01_schema.sql's ALTER DEFAULT PRIVILEGES is why watchlist_* and
-- user_home_prefs arrived with an anon SELECT grant nobody asked for.
-- Public data tables should opt in explicitly instead.
--
-- NOTE: default privileges are per-granting-role. Run this as the SAME role
-- that ran 01_schema.sql (postgres), or it silently does nothing.
-- ────────────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    REVOKE SELECT ON TABLES FROM anon, authenticated;

-- Re-assert the grants the public site actually depends on, so that
-- revoking the default above cannot strand an existing table.
GRANT SELECT ON
    info_agg.leagues, info_agg.sports_news, info_agg.sports_scores,
    info_agg.sports_standings, info_agg.stocks, info_agg.stock_quotes,
    info_agg.company_news, info_agg.market_news, info_agg.etf_holdings,
    info_agg.etf_sectors, info_agg.news_sentiment,
    info_agg.economic_indicators, info_agg.news_articles,
    info_agg.youtube_videos
TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- Scope note
--
-- This project's Supabase instance is shared with other applications,
-- separated by schema (apartments, coffee, ffootball, golf_trip,
-- movie_rankings, muir) plus the shared RBAC tables in `public`. This
-- migration is deliberately confined to the `info_agg` schema and changes
-- nothing outside it.
--
-- The only cross-schema reference is section B's RLS policy calling
-- public.is_super_admin(). That is a read of an existing SECURITY DEFINER
-- function — the same one already used by /dashboard, /api/etl and
-- /api/auth/invite — not a modification of anything in `public`.
--
-- The audit did surface issues in neighbouring schemas (notably ffootball
-- granting anon the full privilege set on every table, including
-- user_platform_credentials). Those are reported separately and are NOT
-- addressed here; they belong to their owning applications.
-- ────────────────────────────────────────────────────────────
