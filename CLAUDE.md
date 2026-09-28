# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ETL Performance Requirement

The full ETL (five fetch domains in parallel, then the `summary` domain sequentially) **must complete in under 60 seconds**. If it takes longer, that is a bug. The historical hang was caused by global rate-limiter locks sleeping while held, which serialized parallel workers. Never introduce a shared global lock that sleeps inside it — use per-key locks only.

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
python src/api/run_etl.py --misc-only                       # Weather, holidays, country, word, wiki, fact
python src/api/run_etl.py --summary-only                    # Regenerate the AI briefings alone (day + week)
python src/api/run_etl.py --skip-sentiment                  # Skip AV sentiment (quotes + news only)
python src/api/run_etl.py --skip-summary                    # Skip the AI briefings (no Gemini call)
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

## ETL Scheduling

**Vercel Cron is the clock; GitHub Actions is the runtime.** Both workflows are
`workflow_dispatch`-only — neither has a `schedule:` trigger. `vercel.json` holds the real
cadence: 16 once-per-day cron entries hitting `GET /api/cron/etl?job=daily|a|b`, each firing
an immediate dispatch.

This is deliberate. GitHub's `schedule:` trigger is best-effort and delivery for this repo
collapsed on 2026-08-27: the 10:43 UTC daily started landing between 14:58 and 21:14 UTC and
intraday runs dropped from ~34/day to 3–5, leaving the site 8–12h stale every morning.
**Do not move the schedule back into the workflow files.**

Vercel Hobby allows 100 cron entries but each runs at most **once per day** with **±59 min**
precision, hence one entry per hour slot rather than a `*/15` expression. The morning is sized
against the worst case: the `0 9 * * *` daily entry fires by 09:59 UTC and finishes ~2 min
later, so it is always done before 11:00 UTC — before 7am ET under both EDT and EST — with
Tier B entries at 10/11/12 UTC covering the 7–9am ET window. Budget: 6 Tier B x 13 FMP calls
+ the daily's 21 = 99 of the 250/day cap.

## ETL Import Constraint

The scheduled runs install **`requirements.txt` only** — `requirements-dev.txt` (pandas, plotly,
selenium, bs4) is explicitly not installed on GitHub Actions. So **any module reachable from
`run_etl.py` or `run_quick_refresh.py` must import only `requirements.txt` packages at module
scope.** Dev-only imports belong inside the functions that need them, or behind a
`try/except ModuleNotFoundError` with a guard.

This is not theoretical. `misc/weather.py` carries Plotly chart builders alongside the two
fetchers the ETL actually uses, and imported numpy/pandas/plotly at the top. Because
`run_etl.py` imports `misc.misc_db_helper` unconditionally, that made the whole pipeline
unimportable without them — the daily run and both intraday tiers died at import with
`ModuleNotFoundError: No module named 'numpy'` *before* they could record an `etl_runs` row, so
the failure was invisible to the dashboard. It went unnoticed for months only because the Actions
runner image happened to ship numpy; the runs were depending on an incidental system package.

## Rate Limits

See [`src/api/docs/RATE_LIMITS.md`](src/api/docs/RATE_LIMITS.md) for per-API limits, daily caps, and how rate limiting is implemented in each fetcher.

## ETL Run Status

`etl_runs.status` is `success` | `partial` | `failed`, and both orchestrators exit **1 only on
`failed`** — which is what makes GitHub email about a run. The intraday tiers deliberately absorb a
lost upstream (ESPN 403ing the runner, Finnhub/NYT 429s) as `partial`/exit 0 and only fail once the
outage persists across several runs; the daily run stays strict. Before changing what fails a run —
or adding alerting on top of it — read
[`src/api/docs/RUNBOOK.md`](src/api/docs/RUNBOOK.md#run-status-what-counts-as-a-failure)'s
"Run Status" section, which spells out per domain what is the upstream's fault (degrades) and what
is ours (always fails).

## Environment Variables

`.env.local` (Next.js frontend + ETL):
- `NEXT_PUBLIC_SITE_URL` — Public site origin with no trailing slash (e.g. `https://your-app.vercel.app` or `http://localhost:3000`). Used for metadata, auth email `redirectTo` URLs, and the invite API’s `app_url` / callback links. On Vercel, set this to your production (or preview) URL.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable key (frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (ETL writes, `POST /api/auth/invite`)

**Supabase Auth → URL configuration:** Add redirect URLs for the auth callback route, e.g. `http://localhost:3000/auth/callback` and `${NEXT_PUBLIC_SITE_URL}/auth/callback`.
- API keys for fetchers: `NYT_API_KEY_1`, `NYT_API_KEY_2`, `FINNHUB_API_KEY_1`, `FINNHUB_API_KEY_2`, `FMP_API_KEY`, `ALPHA_VANTAGE_API_KEY` (+ `_1/_2`)
- `WEATHER_API_KEY` — Visual Crossing timeline API. Powers the weather cards. Billed per *day of data*, so cost is `WEATHER_LOCATIONS` × `FORECAST_DAYS` (currently **6 cities × 5 days = 30 records/run**) against 1,000/day.
- `CALENDAR_API_KEY` — Calendarific. Powers the upcoming-holidays card. 500/month free; the daily run uses ~30.
- `COUNTRIES_API_KEY` — REST Countries **v5** (`api.restcountries.com`, bearer auth). **Its free tier is 1,000 requests per MONTH, not per day** — `misc_db_helper._country_is_current()` therefore skips the fetch when today's rotation pick is already stored, capping it at one call per calendar day however often the daily run is dispatched. v3.1 is deprecated and silently returns a stub that parses as JSON with none of the expected keys, which is how the old fetcher produced a row of `None`s without raising.
- `YOUTUBE_API_KEY` — YouTube Data API v3 key (API key only, no OAuth). Powers the trending-videos feed. `videos.list` with `chart=mostPopular` costs 1 unit against a 10,000/day quota, so a daily run is negligible. Create at https://console.cloud.google.com/apis/credentials with the YouTube Data API v3 enabled.
- Spotify playlists/podcast embeds (`lib/top-podcasts.ts`) need no backend fetch — they're live `<iframe>`s, not ETL-synced. `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are still required, though: `app/api/podcasts/search` uses them (client-credentials flow, `lib/spotify-search.ts`) to power the "search a podcast to favorite" UI on `/profile`. Reddit was removed.
- `GEMINI_API_KEY` — Google Gemini (AI Studio). Powers the two AI briefing cards. Optional: unset
  means both cards skip with a note, exactly like the misc keys. Free tier is ~1,500 req/day and the
  daily run spends **at most 2**, so the quota is never the constraint — availability is. Create at
  https://aistudio.google.com/apikey. `GEMINI_MODEL` optionally pins a model ahead of the built-in
  candidate list. **Not** the same as `GOOGLE_API_KEY`, which is the YouTube Data API key; the
  summary domain deliberately does not fall back to it.
- `GITHUB_DISPATCH_TOKEN` — fine-grained PAT with Actions read/write on this repo. Required by `POST /api/etl` (the `/dashboard` admin trigger button) to fire `workflow_dispatch` against `.github/workflows/daily-etl.yml` / `intraday-refresh.yml`, since Vercel serverless has no Python runtime to run the ETL in-process.
- `GITHUB_REPOSITORY` (default `iainmuir6/info-agg-website`) / `GITHUB_DISPATCH_REF` (default `main`) — override the target repo/branch for the workflow dispatch above.
- `CRON_SECRET` — **required for the site to refresh at all.** Vercel Cron (`vercel.json`) attaches `Authorization: Bearer $CRON_SECRET` to its invocations of `GET /api/cron/etl` only when this variable is set on the project; the route fails closed (503) without it, and no ETL runs. Neither workflow has a `schedule:` trigger any more — see the ETL Scheduling section below.
- `VERCEL_ANALYTICS_TOKEN` — Vercel access token (vercel.com/account/tokens) scoped to the team that owns the project. Read server-side by `lib/web-analytics.ts` to query the Web Analytics API for `/dashboard/activity`; unset means that page shows a setup notice. `VERCEL_ANALYTICS_PROJECT_ID` / `VERCEL_ANALYTICS_TEAM_ID` optionally override the built-in ids. The data itself comes from `<Analytics />` in `app/layout.tsx`, and needs Analytics enabled on the Vercel project.
- `REVALIDATE_SECRET` — bearer token `POST /api/revalidate` checks before calling `revalidateTag("etl-data")`. The GitHub Actions ETL workflow calls this after a successful run so the site's cached data refreshes within seconds.

## Architecture

This is a personal information aggregator ("Info Hub") with two layers:

### Next.js Frontend (`app/`, `components/`, `lib/`)

**Route groups:**
- `app/(public)/` — Public-facing pages with a shared newspaper-style layout (`layout.tsx`). Routes: `/` (Command Center dashboard), `/news`, `/sports`, `/sports/[league]`, `/[league]/[team]`, `/markets`, `/markets/[ticker]`, `/media`, `/misc` (Almanac), `/summary` (the two AI briefings in full — reachable only from their Command Center cards, deliberately not in `NAV_LINKS`), `/economy`, `/profile` (favorites + podcast search, signed-in users), `/dashboard` (ETL run monitoring + trigger, `super_admin` only), `/dashboard/activity` (site traffic from Vercel Web Analytics — range picker, period-over-period KPIs, and click-to-filter breakdowns by page/route/referrer/country/device/browser/OS/UTM; `super_admin` only)
- `app/(auth)/auth/` — Auth pages: login, sign-up, sign-up-success, forgot-password, update-password, error. Shared two-pane shell in `layout.tsx` (masthead pane on `lg+`, collapses on a phone)
- `app/auth/callback/route.ts` — Supabase PKCE exchange (`GET /auth/callback?code=…&next=…`)
- `app/auth/sign-in/route.ts` — `POST /auth/sign-in`, the target of the login form's native submit. Same-origin checked (`isAllowedSameOriginMutation`), `next` validated (`isSafeAuthNextPath`), 303 on success so the browser follows with GET. Errors come back as `/auth/login?error=…`; the submitted email is deliberately not echoed onto the URL
- `app/api/etl/` — `POST /api/etl` (`super_admin` only) fires a `workflow_dispatch` against `.github/workflows/daily-etl.yml` (or `intraday-refresh.yml` with `{ mode: "quick" }`) and returns immediately — Vercel serverless has no Python runtime, so the ETL always runs on GitHub Actions, never in-process. Progress shows up in `info_agg.etl_runs` and the Actions tab.
- `app/api/cron/etl/` — `GET /api/cron/etl?job=daily|a|b` (bearer `CRON_SECRET`) — the unattended scheduler. Called by the 16 cron entries in `vercel.json`; each fires a `workflow_dispatch` and records `triggered_by='cron'`. Shares `lib/github-dispatch.ts` with `POST /api/etl`.
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
- `components/auth/auth-ui.tsx` — the panel/field/submit primitives every auth screen is built from, in the site's own hairline-and-mono language rather than stock shadcn Cards
- `components/thumb-image.tsx` — every third-party thumbnail goes through this (see **Thumbnails** below)
- `lib/brand.ts` — `LOGO_SRC`, the app mark shared by the public masthead and the auth screens. It is the same file the installed PWA uses as its home-screen icon, which is the point: the icon you tap and the header you land in should agree
- Tailwind CSS with CSS variable-based theming; `next-themes` for dark/light mode
- Geist Sans font loaded from local `node_modules/geist`. The auth screens are deliberately Georgia + system mono, so Chrome reports Geist's preloads as unused on those routes — cosmetic, not a bug

**Auth form conventions (`components/*-form.tsx`)**

Credential inputs must carry **both `name` and `autoComplete`** — `username` /
`current-password` on login, `new-password` on sign-up and password change.
Safari and Chrome key AutoFill off those attributes, and the forms originally
shipped with only an `id`, so the iOS keychain suggestion silently stopped
appearing. `UpdatePasswordForm` additionally renders a hidden read-only
`username` input (its two callers pass the address in) because a lone password
field gives the manager nothing to attach a *save* to.

Input text and placeholder share one size (`text-[12px]`) so a field does not
change scale as you type into it. This is a knowing trade-off: **iOS Safari
zooms the page on focus for any input under 16px.** The 16px alternative needed
the placeholder shrunk separately, which read as two type scales in one control.
The zoom is suppressed by `maximumScale: 1` in the `viewport` export in
`app/layout.tsx` — the two settings only make sense together, so **do not raise
the input size or drop the viewport cap without reconsidering the other**. On
iOS 10+ the cap is honoured for automatic focus zoom but the user can still
pinch past it; Chrome on Android does enforce it, capping pinch-zoom at 1x.

**Login is a native form POST, and that is load-bearing.**
`components/login-form.tsx` submits to `app/auth/sign-in/route.ts` with a plain
`method="post"` — no `preventDefault`, no XHR, and deliberately **not** a server
action, because React intercepts a server-action submit with fetch and produces
no navigation at all. Two things depend on the navigation being real:

- iOS only offers **Save Password** when it sees a username+password form
  submitted and then a navigation. The original client-side flow did
  `preventDefault` → XHR → `router.push()`, so iOS never observed a login, never
  saved a credential, and AutoFill in the installed PWA therefore had nothing to
  offer even though the markup was correct.
- The session cookie is set here as a real `Set-Cookie`, so it escapes WebKit's
  7-day cap on script-written cookies at the moment the session is created,
  rather than waiting for the proxy to slide it.

The login inputs are **uncontrolled** for the same reason: a password manager
fills a field by setting its value directly, and a controlled React input is the
classic way that fill gets reverted on the next render.

(An earlier revision of this file claimed PWA AutoFill was an unfixable WKWebView
platform limitation. That was wrong — it generalised from reports about *native
apps embedding* WKWebView, which do need an Associated Domains entitlement. A
home-screen web app is first-party web content and can autofill.)

**Sessions in the iOS home-screen PWA**

An installed home-screen web app has its own cookie jar, separate from Safari's,
so a sign-in in one never carries to the other and an emailed reset link (which
opens in Safari) does not reach the PWA's session. That part is inherent to iOS.

The part that was ours: `@supabase/ssr`'s browser client writes the auth cookie
with `document.cookie` asking for 400 days, and WebKit caps anything written
from script at **7 days**. Supabase only emits a real (uncapped) `Set-Cookie`
from `setAll`, i.e. when it actually rotates tokens — so a PWA opened briefly
and often could live on nothing but the 7-day script cookie and then lose it.
`auth.sessions` showed it: mobile rows with `refreshed_at` NULL and one unused
refresh token each.

`lib/supabase/proxy.ts` now does a **sliding re-issue** — on an authenticated
request that did *not* rotate, it re-sends the auth cookies the browser just
sent, unchanged, as a server `Set-Cookie`. Constraints that make it safe, and
that any edit here must preserve:

- Only `sb-*-auth-token[.N]`. The PKCE `-code-verifier` is deliberately excluded
  from the regex — it is meant to be short-lived.
- Only when `rotated` is false. Supabase's own values always win.
- Only when there are valid claims. An invalid token gets Supabase's `Max-Age=0`
  clearing cookie instead, which is the behaviour to keep.
- `SESSION_COOKIE_OPTIONS` mirrors @supabase/ssr's unexported
  `DEFAULT_COOKIE_OPTIONS`. **Keep `path` in step with it**: the browser keys a
  cookie on (name, domain, path), so a different path silently creates a second
  cookie beside the real one instead of replacing it. `secure` is ours, added
  only over HTTPS so local http dev still works.

This changes only how long the *browser* keeps the credential, never whether it
works — validity is still decided at Supabase. Which is worth knowing, because
`not_after` is NULL on every row: there is **no session timebox or inactivity
timeout configured**, so sessions now really do last. The lever for an actual
ceiling is Supabase → Auth → Sessions, server-side.

The first cookie after sign-in is now server-set too — see the login route
above — so the proxy's sliding re-issue covers the ongoing case rather than
having to rescue a 7-day cookie created at sign-in.

**Thumbnails**

Thumbnail URLs are third-party and frozen into the database at ETL time, so they
rot — the row keeps a URL that no longer serves a picture. `{url && <img/>}`
guards only the NULL column. `components/thumb-image.tsx` also covers `onError`
**and** YouTube's grey "no thumbnail" tile, which arrives with a **200** and is
identifiable only by coming back 120px wide whatever size was requested.
`default.jpg` is excluded from that test: it is legitimately 120x90 and is the
last entry in `src/api/media/youtube.py`'s preference list, so without the
exclusion every video that only had a `default` thumbnail would be hidden.

### Python ETL (`src/api/`)

Orchestrator: `src/api/run_etl.py` — runs the four fetch-domain ETL pipelines **in parallel** (`ThreadPoolExecutor`), which is what the <60s requirement above depends on. `run_quick_refresh.py` is the tiered intraday counterpart (Tier A every 15 min, Tier B hourly — no backfill, no daily API budget spent on Tier A); `run_test.py` dry-run-tests every external API endpoint with no DB writes; `backfill_scores.py` is the standalone recovery tool for historical ESPN scores. The fifth
domain, `summary/`, runs sequentially after the parallel block because it reads what the others wrote.

Each domain follows the same pattern:
- `{domain}/{domain}_fetcher.py` — calls external APIs
- `{domain}/{domain}_db_helper.py` — upserts into Supabase using service role key
- `{domain}/migrations/` — historical per-domain SQL migrations (superseded by unified `supabase/` files)

**Domain → data sources:**
- `sports/` → ESPN API (scores + news for NFL, NBA, NHL, MLB, EPL, etc.)
- `markets/` → Finnhub API (daily quotes, company news, market news) + FMP API (company profiles, commodity quotes, treasury/econ, ETF holdings) + Alpha Vantage (news sentiment) + **Frankfurter** (forex — keyless ECB reference rates, all 10 pairs in one request; replaced 10 FMP calls per intraday Tier B run, cutting FMP from 78 to 18 calls/day. Trade-off: ECB publishes once per business day, so forex no longer moves intraday)
- `news/` → NYT Top Stories + Most Popular API (NewsAPI is not used anywhere in this codebase, despite what an earlier version of this doc claimed)
- `media/` → YouTube Data API (trending videos). Spotify (playlists, Top Podcasts) is live-embedded on the frontend with no fetcher. Reddit was removed.
- `misc/` → six feeds behind one domain (all single-call except weather, which is one call per city): Visual Crossing (weather, 6 cities — one call each), Calendarific (US holidays), REST Countries v5 (country of the day, rotating), Wikipedia REST (random summary + On This Day), Merriam-Webster RSS (word of the day), uselessfacts. All land in `misc_content` as JSONB; each source degrades independently, and the domain never fails the run
- `summary/` → Google Gemini (AI briefings: "Summary of the Day" and "Summary of the Week"). The only
  domain with **no upstream of its own** — it summarises the rows the other four just wrote, which is
  why `run_full_etl` calls it **sequentially after** the parallel block instead of inside it. Running
  it in parallel would summarise yesterday's data. Everything the model may assert is supplied in a
  context bundle built from the database, and the forward-looking half of the daily card is grounded
  in the only forward-looking rows the schema holds (scheduled games, upcoming holidays) plus
  unresolved threads in stories already in the bundle. Both briefings are freshness-gated — the daily
  on the Eastern calendar day, the weekly on the ISO week — so a re-dispatched run costs no
  generation, and any failure leaves the previous briefing in place rather than emptying the card
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
9. `09_security_hardening.sql` — anon least-privilege pass: scrubs API keys leaked into `etl_runs`,
   restricts `etl_runs` to three health columns for `anon` (full row = `super_admin` only), drops
   anon's unused SELECT on the `watchlist_*`/`user_home_prefs` tables, and removes the
   `ALTER DEFAULT PRIVILEGES … GRANT SELECT TO anon` in `01` that made every new `info_agg` table
   world-readable by default. **New public tables now need an explicit `GRANT SELECT`.**
10. `10_misc_content.sql` — `misc_content`, the single JSONB-payload table behind the six almanac
   cards (weather, holidays, country, word, Wikipedia, fact), keyed on `(kind, key)`, plus its
   index, RLS policy and the explicit `GRANT SELECT` that `09` now requires. One table rather than
   six: the feeds are small, display-only and read whole, with no joins or cross-row filters. The
   payload shape is enforced in `lib/misc-content.ts`, not by Postgres.

11. `11_ai_summaries.sql` — widens `misc_content`'s `kind` CHECK to allow `'summary'`, the two AI
   briefing rows (keys `day` and `week`). No new table: same small, display-only, read-whole shape
   that `10` was built for. Index, RLS policy and grant are table-wide and already cover it. The
   payload shape is enforced in `lib/ai-summary.ts`.
12. `12_news_churn.sql` — `suppress_redundant_updates_trigger()` on the five news tables, so a
   re-fetched story that hasn't changed writes nothing (no-op upserts had bloated their indexes
   5–10x). A suppressed row is missing from `RETURNING`, which is why `chunked_upsert` uses
   `return=minimal` and counts the batch — **don't switch it back to counting `resp.data`**, or an
   unchanged feed reads as "wrote 0" and fails the run-status checks. `company_news` is also
   written insert-or-skip (`ignore_duplicates=True`).

> This Supabase project is shared with other apps, separated by schema. Keep `info_agg` migrations
> scoped to `info_agg` — do not modify `public` or another app's schema from this repo.

**Key tables:**
- Sports: `leagues`, `sports_news`, `sports_scores`, `sports_standings`
- Markets: `stocks`, `stock_quotes`, `etf_holdings`, `company_news`, `market_news`, `news_sentiment`
- News: `news_articles`
- Media: `youtube_videos` (Spotify playlists/podcasts are embedded, not stored)
- Misc: `misc_content` — one JSONB row per (kind, key) for all six almanac cards, plus the two
  AI briefings at `('summary','day')` and `('summary','week')`
- User prefs: `watchlist_stocks`, `watchlist_leagues`, `watchlist_teams`, `watchlist_podcasts`, `user_home_prefs`
- Ops: `etl_runs` — one row per ETL run (status, tier, timing, per-domain stats/errors), read by `/dashboard`

The ETL uses `SUPABASE_SERVICE_ROLE_KEY` with `ClientOptions(schema='info_agg')` for writes. The frontend uses the publishable key targeting the same schema.

### Sharing `info_agg` data with another app in this project

This Supabase project is shared by several apps, separated by schema. The 14
`info_agg` data tables (`stocks`, `stock_quotes`, `sports_*`, `*_news`,
`news_articles`, `news_sentiment`, `economic_indicators`, `etf_*`,
`youtube_videos`, `leagues`) are already `SELECT`-able by `anon` and
`authenticated` — this is a public site, so reading them from another schema
adds **no new exposure**. Access is granted per table, so the restricted ones
stay restricted: `watchlist_*` and `user_home_prefs` are owner-scoped by RLS,
and `etl_runs` exposes only `status/started_at/finished_at` to `anon`.

Two ways to consume them:

1. **Point a client at the schema.** No DB changes: the other app creates a
   Supabase client with `db: { schema: "info_agg" }` (or sends
   `Accept-Profile: info_agg`). A client targets one schema at a time — this
   repo already does this, with `createClient()` on `info_agg` and
   `createPublicClient()` on `public`.

2. **Wrap them in views in the consuming schema**, if that app wants its own
   naming or a narrowed subset.

**If you use views, `security_invoker = true` is mandatory and is NOT the
default.** A plain `CREATE VIEW` runs as its owner and silently bypasses the
base table's RLS — verified: a definer view over `watchlist_stocks` returned
another user's row to a roleless caller, while the invoker view returned zero.

```sql
CREATE SCHEMA IF NOT EXISTS newapp;
GRANT USAGE ON SCHEMA newapp TO anon, authenticated;

CREATE VIEW newapp.tickers WITH (security_invoker = true) AS
  SELECT ticker, name, exchange FROM info_agg.stocks;

GRANT SELECT ON newapp.tickers TO anon, authenticated;
```

Checklist for the consuming schema:

- Add the schema to **Supabase → Settings → API → Exposed schemas**, or
  PostgREST will not serve it.
- Keep it **read-only** against `info_agg`. The ETL owns those tables and
  writes via `service_role`; never grant another app write access to them.
- Share only the public data tables. Cross-app access to `watchlist_*` /
  `user_home_prefs` is a deliberate design decision, not a default.
- Grant to `authenticated` (or gate on `has_project_role`) rather than `anon`
  for anything that should not be world-readable. **Note:** signup is open and
  auto-confirms, so `authenticated` means "anyone who registered" — it is not
  by itself an authorization boundary.
- Foreign keys across schemas work normally: a new app's tables can reference
  `info_agg.stocks(id)` directly.
- Because `09` removed the schema-wide default `GRANT SELECT`, a **new** shared
  table added to `info_agg` is unreadable until you `GRANT SELECT` on it
  explicitly. That is intended.

### Adding a New Data Source

1. Create `src/api/{domain}/{domain}_fetcher.py` and `{domain}_db_helper.py`
2. Add a new table to `supabase/02_tables.sql` and corresponding RLS/indexes
3. Add a `run_{domain}_etl()` function in `src/api/run_etl.py`
4. Add a new route under `app/(public)/{domain}/page.tsx` and update the `NAV_LINKS` in `app/(public)/layout.tsx`
