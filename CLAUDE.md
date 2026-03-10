# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev          # Start Next.js dev server with Turbopack (localhost:3000)
pnpm build        # Production build
pnpm lint         # ESLint

# ETL (Python — run from repo root)
source _agg_venv/bin/activate
python src/api/run_etl.py                          # Daily run (all domains; FMP runs inside markets)
python src/api/run_etl.py --seed                   # Initial seed: backfill 90d quotes + 30d news/sports
python src/api/run_etl.py --sports-only
python src/api/run_etl.py --markets-only           # Includes FMP
python src/api/run_etl.py --news-only
python src/api/run_etl.py --media-only
python src/api/run_etl.py --fmp-etf-only           # Within markets: FMP for ETF tickers only (saves budget)
python src/api/run_etl.py --backfill-quotes 30     # Backfill market OHLCV history
python src/api/run_etl.py --backfill-news 30       # Backfill NYT articles via Archive API*
python src/api/run_etl.py --backfill-sports 30     # Backfill ESPN scores
# *Requires Archive API product enabled at developer.nytimes.com/my-apps
# See src/api/RUNBOOK.md for full seed vs. daily run guide
```

## Rate Limits

See [`src/api/RATE_LIMITS.md`](src/api/RATE_LIMITS.md) for per-API limits, daily caps, and how rate limiting is implemented in each fetcher.

## Environment Variables

`.env.local` (Next.js frontend + ETL):
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable key (frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (ETL writes only)
- API keys for fetchers: `NYT_API_KEY`, `NEWS_API_KEY`, `FINNHUB_API_KEY`, `FMP_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

## Architecture

This is a personal information aggregator ("Info Hub") with two layers:

### Next.js Frontend (`app/`, `components/`, `lib/`)

**Route groups:**
- `app/(public)/` — Public-facing pages with a shared newspaper-style layout (`layout.tsx`). Routes: `/` (Command Center dashboard), `/news`, `/sports`, `/markets`, `/media`
- `app/(auth)/auth/` — Auth pages: login, sign-up, forgot-password, update-password
- `app/api/etl/` — REST endpoint (`POST /api/etl`) that triggers the Python ETL pipeline for authenticated users

**Supabase client pattern:**
- `lib/supabase/server.ts` — Server Components and Route Handlers (cookie-based auth)
- `lib/supabase/client.ts` — Client Components
- `lib/supabase/middleware.ts` — Session refresh in middleware
- All clients target the custom `info_agg` schema (not `public`) via `db: { schema: "info_agg" }`
- `middleware.ts` runs on every request to refresh sessions

**UI:**
- shadcn/ui components in `components/ui/` (badge, button, card, checkbox, dropdown-menu, input, label)
- Custom components in `components/` (news ticker, theme switcher, auth forms, etc.)
- Tailwind CSS with CSS variable-based theming; `next-themes` for dark/light mode
- Geist Sans font loaded from local `node_modules/geist`

### Python ETL (`src/api/`)

Orchestrator: `src/api/run_etl.py` — runs all four domain ETL pipelines sequentially.

Each domain follows the same pattern:
- `{domain}/{domain}_fetcher.py` — calls external APIs
- `{domain}/{domain}_db_helper.py` — upserts into Supabase using service role key
- `{domain}/migrations/` — historical per-domain SQL migrations (superseded by unified `supabase/` files)

**Domain → data sources:**
- `sports/` → ESPN API (scores + news for NFL, NBA, NHL, MLB, EPL, etc.)
- `markets/` → Finnhub API (daily quotes, company news, market news) + FMP API (company profiles, ETF holdings, historical backfill) + Alpha Vantage (news sentiment)
- `news/` → NYT Top Stories API + NewsAPI
- `media/` → Spotify API (new releases) + Reddit API (hot posts)
- `misc/` — placeholder for additional sources

Python venv: `_agg_venv/` (at repo root). Dependencies: `src/api/requirements.txt`.

### Supabase Database (`supabase/`)

All tables live in the `info_agg` schema. Apply migrations in order:
1. `01_schema.sql` — creates `info_agg` schema, grants, and `set_updated_at()` trigger function
2. `02_tables.sql` — all table definitions + seed data for `leagues`
3. `03_rls.sql` — Row Level Security policies
4. `04_indexes.sql` — performance indexes

**Key tables:**
- Sports: `leagues`, `sports_news`, `sports_scores`
- Markets: `stocks`, `stock_quotes`, `etf_holdings`, `company_news`, `market_news`, `news_sentiment`
- News: `news_articles`
- Media: `spotify_releases`, `reddit_posts`

The ETL uses `SUPABASE_SERVICE_ROLE_KEY` with `ClientOptions(schema='info_agg')` for writes. The frontend uses the publishable key targeting the same schema.

### Adding a New Data Source

1. Create `src/api/{domain}/{domain}_fetcher.py` and `{domain}_db_helper.py`
2. Add a new table to `supabase/02_tables.sql` and corresponding RLS/indexes
3. Add a `run_{domain}_etl()` function in `src/api/run_etl.py`
4. Add a new route under `app/(public)/{domain}/page.tsx` and update the `NAV_LINKS` in `app/(public)/layout.tsx`
