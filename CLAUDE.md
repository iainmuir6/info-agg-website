# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ETL Performance Requirement

The full ETL (all 4 domains in parallel) **must complete in under 60 seconds**. If it takes longer, that is a bug. The historical hang was caused by global rate-limiter locks sleeping while held, which serialized parallel workers. Never introduce a shared global lock that sleeps inside it — use per-key locks only.

## Commands

```bash
# Development
pnpm dev          # Start Next.js dev server with Turbopack (localhost:3000)
pnpm build        # Production build
pnpm lint         # ESLint

# ETL (Python — run from repo root)
source _agg_venv/bin/activate && python src/api/run_etl.py  # Daily run (all domains, all 10 sentiment topics)
python src/api/run_etl.py --sports-only
python src/api/run_etl.py --markets-only                    # Quotes + news + sentiment + economic indicators
python src/api/run_etl.py --news-only
python src/api/run_etl.py --media-only
python src/api/run_etl.py --skip-sentiment                  # Skip AV sentiment (quotes + news only)
python src/api/run_etl.py --cleanup --season-schedules      # What the daily cron runs (+ retention cleanup)
python src/api/run_etl.py --test                            # Dry-run: hit every external API once, no DB writes

# Tiered intraday refresh (the frequent counterpart to the daily run — no backfill, budget-aware)
python src/api/run_quick_refresh.py --tier a                 # Every 15 min: quotes + scoreboards + market news
python src/api/run_quick_refresh.py --tier b                 # Hourly: tier A + NYT top stories + ESPN news + FMP

# Historical score backfill (one-off / recovery — safe to re-run, upserts by event)
python src/api/backfill_scores.py --season current           # Current season, all leagues
python src/api/backfill_scores.py --leagues wnba --season 2026
python src/api/backfill_scores.py --leagues nfl,nba --season 2023,2024,2025
python src/api/backfill_scores.py --start 2026-04-01 --end 2026-07-29
python src/api/backfill_scores.py --season current --dry-run # Show the plan, write nothing

# *Requires Archive API product enabled at developer.nytimes.com/my-apps
# See src/api/docs/RUNBOOK.md for the full daily-run guide
```

> `run_db_seed.py` (initial seed / historical OHLCV+news+sports backfill) was moved to
> `src/api/archive/` and is currently **broken** — it calls `run_sports_etl()`/`run_news_etl()`
> with a `backfill_days` kwarg those functions no longer accept. There is presently no working
> initial-seed path; `src/api/docs/RUNBOOK.md`'s "Initial Seed" section documents the old
> (now non-functional) design for reference only. Score history has a working equivalent —
> `backfill_scores.py`, above — quote/news history does not yet.

## Rate Limits

See [`src/api/docs/RATE_LIMITS.md`](src/api/docs/RATE_LIMITS.md) for per-API limits, daily caps, and how rate limiting is implemented in each fetcher.

## Environment Variables

`.env.local` (Next.js frontend + ETL):
- `NEXT_PUBLIC_SITE_URL` — Public site origin with no trailing slash (e.g. `https://your-app.vercel.app` or `http://localhost:3000`). Used for metadata, auth email `redirectTo` URLs, and the invite API’s `app_url` / callback links. On Vercel, set this to your production (or preview) URL.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable key (frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (ETL writes, `POST /api/auth/invite`)

**Supabase Auth → URL configuration:** Add redirect URLs for the auth callback route, e.g. `http://localhost:3000/auth/callback` and `${NEXT_PUBLIC_SITE_URL}/auth/callback`.
- API keys for fetchers: `NYT_API_KEY_1`, `NYT_API_KEY_2`, `FINNHUB_API_KEY_1`, `FINNHUB_API_KEY_2`, `FMP_API_KEY`, `ALPHA_VANTAGE_API_KEY` (+ `_1/_2`)
- `YOUTUBE_API_KEY` — YouTube Data API v3 key (API key only, no OAuth). Powers the trending-videos feed. `videos.list` with `chart=mostPopular` costs 1 unit against a 10,000/day quota, so a daily run is negligible. Create at https://console.cloud.google.com/apis/credentials with the YouTube Data API v3 enabled.
- Spotify playlists/podcast embeds (`lib/top-podcasts.ts`) need no backend fetch — they're live `<iframe>`s, not ETL-synced. `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are still required, though: `app/api/podcasts/search` uses them (client-credentials flow, `lib/spotify-search.ts`) to power the "search a podcast to favorite" UI on `/profile`. Reddit was removed.
- `GITHUB_DISPATCH_TOKEN` — fine-grained PAT with Actions read/write on this repo. Required by `POST /api/etl` (the `/dashboard` admin trigger button) to fire `workflow_dispatch` against `.github/workflows/daily-etl.yml` / `intraday-refresh.yml`, since Vercel serverless has no Python runtime to run the ETL in-process.
- `GITHUB_REPOSITORY` (default `iainmuir6/info-agg-website`) / `GITHUB_DISPATCH_REF` (default `main`) — override the target repo/branch for the workflow dispatch above.
- `REVALIDATE_SECRET` — bearer token `POST /api/revalidate` checks before calling `revalidateTag("etl-data")`. The GitHub Actions ETL workflow calls this after a successful run so the site's cached data refreshes within seconds.

## Architecture

This is a personal information aggregator ("Info Hub") with two layers:

### Next.js Frontend (`app/`, `components/`, `lib/`)

**Route groups:**
- `app/(public)/` — Public-facing pages with a shared newspaper-style layout (`layout.tsx`). Routes: `/` (Command Center dashboard), `/news`, `/sports`, `/sports/[league]`, `/[league]/[team]`, `/markets`, `/markets/[ticker]`, `/media`, `/economy`, `/profile` (favorites + podcast search, signed-in users), `/dashboard` (ETL run monitoring + trigger, `super_admin` only)
- `app/(auth)/auth/` — Auth pages: login, sign-up, forgot-password, update-password
- `app/auth/callback/route.ts` — Supabase PKCE exchange (`GET /auth/callback?code=…&next=…`)
- `app/api/etl/` — `POST /api/etl` (`super_admin` only) fires a `workflow_dispatch` against `.github/workflows/daily-etl.yml` (or `intraday-refresh.yml` with `{ mode: "quick" }`) and returns immediately — Vercel serverless has no Python runtime, so the ETL always runs on GitHub Actions, never in-process. Progress shows up in `info_agg.etl_runs` and the Actions tab.
- `app/api/revalidate/` — `POST /api/revalidate` (bearer `REVALIDATE_SECRET`) — called by the GitHub Actions workflow after a successful run to `revalidateTag("etl-data")` so the site picks up new rows within seconds.
- `app/api/auth/invite/` — `POST /api/auth/invite` with `{ "email": "…" }` — `super_admin` only; sends Supabase invite email (callback → update-password)
- `app/api/podcasts/search/` — client-credentials Spotify search backing the "favorite a podcast" UI on `/profile`

**Supabase client pattern:**
- `lib/supabase/server.ts` — Server Components and Route Handlers (cookie-based auth)
- `lib/supabase/client.ts` — Client Components
- `lib/supabase/proxy.ts` — Session refresh (`proxy.ts` at repo root runs on matched routes)
- `lib/supabase/service-role.ts` — Service-role client (bypasses RLS) used by routes like `/api/auth/invite`
- `lib/supabase/public-client.ts` — Targets the `public` schema (not `info_agg`) for RPCs such as `is_super_admin()`
- All `info_agg`-schema clients target it via `db: { schema: "info_agg" }`, not `public`
- `proxy.ts` runs on matched requests to refresh sessions

**UI:**
- shadcn/ui components in `components/ui/` (badge, button, card, checkbox, dropdown-menu, input, label)
- Custom components in `components/` (news ticker, theme switcher, auth forms, etc.)
- Tailwind CSS with CSS variable-based theming; `next-themes` for dark/light mode
- Geist Sans font loaded from local `node_modules/geist`

### Python ETL (`src/api/`)

Orchestrator: `src/api/run_etl.py` — runs all four domain ETL pipelines **in parallel** (`ThreadPoolExecutor`), which is what the <60s requirement above depends on. `run_quick_refresh.py` is the tiered intraday counterpart (Tier A every 15 min, Tier B hourly — no backfill, no daily API budget spent on Tier A); `run_test.py` dry-run-tests every external API endpoint with no DB writes; `backfill_scores.py` is the standalone recovery tool for historical ESPN scores.

Each domain follows the same pattern:
- `{domain}/{domain}_fetcher.py` — calls external APIs
- `{domain}/{domain}_db_helper.py` — upserts into Supabase using service role key
- `{domain}/migrations/` — historical per-domain SQL migrations (superseded by unified `supabase/` files)

**Domain → data sources:**
- `sports/` → ESPN API (scores + news for NFL, NBA, NHL, MLB, EPL, etc.)
- `markets/` → Finnhub API (daily quotes, company news, market news) + FMP API (company profiles, ETF holdings, historical backfill) + Alpha Vantage (news sentiment)
- `news/` → NYT Top Stories + Most Popular API (NewsAPI is not used anywhere in this codebase, despite what an earlier version of this doc claimed)
- `media/` → YouTube Data API (trending videos). Spotify (playlists, Top Podcasts) is live-embedded on the frontend with no fetcher. Reddit was removed.
- `misc/` — working fetchers (countries, facts, holidays, weather, wikipedia, words) that exist but aren't wired into `run_etl.py`; not a placeholder, just unintegrated
- `archive/` — retired scripts kept for reference, not run by anything (`run_db_seed.py`, `seed.py`, `av_seed.py`, plus old schema docs)

Python venv: `_agg_venv/` (at repo root). Dependencies: `requirements.txt` (repo root).

### Supabase Database (`supabase/`)

All tables live in the `info_agg` schema. Apply migrations in order:
1. `01_schema.sql` — creates `info_agg` schema, grants, `set_updated_at()` trigger function, and retention (`cleanup_daily()`)
2. `02_tables.sql` — all table definitions + seed data for `leagues`, including `etl_runs`
3. `03_rls.sql` — Row Level Security policies
4. `04_indexes.sql` — performance indexes
5. `05_prune.sql` — drops the legacy `user_role` enum + unused indexes (idempotent)
6. `06_user_prefs.sql` — watchlist tables (`watchlist_stocks`, `watchlist_leagues`, `watchlist_teams`) + `user_home_prefs`
7. `07_grants.sql` — explicit `INSERT/UPDATE/DELETE` grants for the tables `06` creates (RLS alone isn't enough — see comment in the file; Postgres checks table-level privileges before RLS runs)
8. `08_watchlist_podcasts.sql` — `watchlist_podcasts` (favorited Spotify shows) + its own grants

**Key tables:**
- Sports: `leagues`, `sports_news`, `sports_scores`, `sports_standings`
- Markets: `stocks`, `stock_quotes`, `etf_holdings`, `company_news`, `market_news`, `news_sentiment`
- News: `news_articles`
- Media: `youtube_videos` (Spotify playlists/podcasts are embedded, not stored)
- User prefs: `watchlist_stocks`, `watchlist_leagues`, `watchlist_teams`, `watchlist_podcasts`, `user_home_prefs`
- Ops: `etl_runs` — one row per ETL run (status, tier, timing, per-domain stats/errors), read by `/dashboard`

The ETL uses `SUPABASE_SERVICE_ROLE_KEY` with `ClientOptions(schema='info_agg')` for writes. The frontend uses the publishable key targeting the same schema.

### Adding a New Data Source

1. Create `src/api/{domain}/{domain}_fetcher.py` and `{domain}_db_helper.py`
2. Add a new table to `supabase/02_tables.sql` and corresponding RLS/indexes
3. Add a `run_{domain}_etl()` function in `src/api/run_etl.py`
4. Add a new route under `app/(public)/{domain}/page.tsx` and update the `NAV_LINKS` in `app/(public)/layout.tsx`
