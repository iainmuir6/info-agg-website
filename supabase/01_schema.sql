-- ============================================================
-- 01_schema.sql — Schema, grants, and shared trigger functions
--
-- Run order: 1 of 4
-- Author: IM / Scouts Consulting Group
-- ============================================================

-- Create the dedicated schema
CREATE SCHEMA IF NOT EXISTS info_agg;

-- ============================================================
-- PostgREST visibility
-- Allows the Supabase JS/Python client to target this schema
-- via db: { schema: 'info_agg' } / ClientOptions(schema='info_agg')
-- ============================================================
GRANT USAGE ON SCHEMA info_agg TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA info_agg
    GRANT ALL ON SEQUENCES TO service_role;

-- ============================================================
-- Shared trigger function — updates updated_at on every write
-- ============================================================
CREATE OR REPLACE FUNCTION info_agg.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
