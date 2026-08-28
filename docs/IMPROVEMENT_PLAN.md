# Improvement Plan — ETL Reliability, Scheduling, Freshness, and Design

Proposal based on a full audit of the ETL pipeline (`src/api/`) and the Next.js frontend
(`app/`, `components/`, `lib/`). Organized in phases: P0 items make the ETL bulletproof and
reliably scheduled; P1 makes the site feel alive (auto-refresh, freshness); P2 is design,
density, and cleanup.

> **Status update:** most of Phase 0, plus §1.1, §1.2, and §1.7, shipped within days of this
> plan being written and are marked `[DONE]` inline below with the commit that landed them.
> Phase 2 has not been revisited since this doc was written — treat those items as still open
> unless you've verified otherwise against current code.

---

## Phase 0 — One scheduler, honest failures (the "bulletproof" core)

### 0.1 [DONE — `cb53b10`] Kill the Vercel cron; make GitHub Actions the single scheduler
Today **two crons fire 5 minutes apart at the same hour** against the same APIs and tables:
`vercel.json` (`0 12 * * *` → `/api/cron/etl`) and `.github/workflows/daily-etl.yml`
(`5 12 * * *`). The Vercel path cannot ever succeed:

- `app/api/cron/etl/route.ts` spawns Python via `execFile` — the Vercel serverless runtime has
  no `python3`, no `_agg_venv`, and `src/api/*.py` isn't in the function bundle.
- Even if it ran, the route kills the process at 55s while `RUNBOOK.md` documents a 5–7 minute
  full run — a guaranteed mid-run SIGTERM that drops un-flushed batch upserts.

**Action:** delete the `crons` block from `vercel.json`, delete `app/api/cron/etl/route.ts`,
and treat `daily-etl.yml` as the only scheduler. Add a `concurrency:` group to the workflow so
a manual dispatch can't overlap the cron.

### 0.2 [DONE — `68f208c`] Add an `etl_runs` table (run metadata + observability)
Nothing about a run currently survives it — no run table, the in-memory `results` dict is only
written with `--output` (which the workflow doesn't pass), and ~460 `print()` calls with no
timestamps are the only trace.

**Action:** new `info_agg.etl_runs` table: `run_id, trigger (cron|manual|quick), started_at,
finished_at, status (running|success|partial|failed), per-domain jsonb stats, errors jsonb`.
`run_etl.py` inserts a row at start and updates it at the end (including on crash, via
`try/finally`). This single table then powers:
- the admin dashboard's freshness display (already exists at `/dashboard`),
- a real "Live"/health indicator in the public header (currently a hardcoded green dot),
- "last updated N min ago" stamps across the site,
- a cheap concurrency lock (skip if a `running` row is younger than N minutes).

### 0.3 [DONE — `68f208c`] Make exit codes and domain stats honest
- `run_markets_etl` returns `success: True` no matter how full `total_stats['errors']` is
  (`run_etl.py:244`) — a run where **every ticker failed still exits 0** and CI goes green.
- Sports write failures never reach `stats['errors']` (`sports_db_helper.py:213–223` — the
  upsert helpers catch and return `0` silently), so a total write failure reports success.

**Action:** define success as "error count below threshold AND at least N rows written per
active domain"; propagate write failures into stats; exit 1 on partial failure so the workflow
turns red when the data is actually bad.

### 0.4 [DONE] Fix the markets fan-out data-loss bug
`run_etl.py:166` calls `future.result()` unwrapped inside the ticker loop. One ticker raising
escapes to the outer `except`, and **all already-collected quotes and news for every other
ticker are discarded** before the Phase 2/3 upserts run. Same pattern in
`run_quick_refresh.py:68`.

**Action:** wrap each `future.result()` in try/except, record the per-ticker error, keep going.
Also: the chunked `upsert_daily_stock_quotes_batch` (100-row batches) is imported at
`run_etl.py:35` **and never called** — the orchestrator does unchunked single-shot upserts of
the entire table at `:175` and `:208` instead, so one rejected payload loses everything.
Use the chunked helpers everywhere; standardize batch size.

### 0.5 [DONE] Retries with backoff on every HTTP call
Grep confirms **zero retry logic in the entire pipeline** — every fetcher does raw
`requests.get` (timeouts are set, which is good). One transient 5xx or connection reset drops
that ticker/section/subreddit for a full day.

**Action:** shared `requests.Session` factory with `urllib3.Retry` (3 attempts, exponential
backoff, retry on 429/5xx/connection errors, honor `Retry-After`). Adopt in all fetchers.
While there: give Finnhub/AV real 429 handling (currently a server-side 429 is printed and
swallowed; AV rotates keys but never retries the original request).

### 0.6 [PARTIALLY DONE] Structured logging + CI failure visibility
`etl_lib.get_logger()` and the `etl-report.json` upload/artifact step exist. Not verified: the
`if: failure()` issue/email step, and whether the `_KEY_3` workflow secret gap was closed —
recheck `daily-etl.yml`'s `env:` block before treating this as fully done.

Note for whoever builds that alerting step: a red run is now *meant* to be rare. GitHub already
emails on exit 1, and the intraday tiers absorb a lost upstream as `partial` rather than failing on
a blip that clears in minutes (see RUNBOOK, "Run Status"). So alert on `failed`, not on `partial`
or on the presence of errors — every healthy run carries a few — and remember that a sustained
outage surfaces as a `failed` run roughly once per streak window, not on every refresh.

**Action:**
- Replace `print()` with the `logging` module (timestamps, levels, per-domain logger names).
- Workflow: pass `--output etl-report.json`, upload it with `actions/upload-artifact`, and add
  an `if: failure()` step that opens/updates a GitHub issue (or sends an email) so a red run is
  not invisible in the Actions tab.
- Fix workflow secret gaps: the code reads `ALPHA_VANTAGE_API_KEY_3`, `FINNHUB_API_KEY_3`,
  `NYT_API_KEY_3`, but `daily-etl.yml` doesn't pass them — quota is silently smaller in CI
  than locally.

### 0.7 [DONE] Preflight validation + consistent degradation
Missing keys behave inconsistently: NYT/Finnhub/FMP/Spotify raise `ValueError` (NYT's kills the
whole news domain), Alpha Vantage degrades gracefully.

**Action:** a preflight step that checks every expected env var, logs exactly what's missing,
and lets each domain degrade gracefully (skip the affected source, mark the run `partial`)
instead of dying.

### 0.8 [DONE] Orchestrator hygiene
- Add `timeout=` to the domain-level `as_completed` (`run_etl.py:405`) — currently the only
  wall clock is the workflow's 30-minute cap.
- Use `with ThreadPoolExecutor(...)` (the pool at `run_etl.py:400` is never shut down).
- Never sleep while holding a module lock (`espn.py:34–41`, `nyt.py:26–35`, `fmp.py:42–59`) —
  this is the exact class of bug called out in CLAUDE.md; convert to compute-sleep-outside-lock.
- Note the FMP "250/day" counter is per-process and resets every invocation — either persist
  the count (e.g. in `etl_runs`) or accept and document it.

### 0.9 Slim, locked CI dependencies
Every scheduled run pip-installs `selenium`, `webdriver-manager`, `pandas`, `plotly`,
`nbformat`, `lxml`, `beautifulsoup4` — Selenium exists only for the **deprecated**
`etfdb.py` scraper.

**Action:** split `requirements.txt` (core ETL) from `requirements-dev.txt`; pin everything or
adopt `pip-tools`/`uv` for a lockfile. Faster installs, fewer flaky scheduled runs.

---

## How long the ETL actually takes (measured)

The RUNBOOK's "5–7 minutes" is stale — it predates the parallel fan-out (the RUNBOOK still
says domains run "sequentially"). Measured from GitHub Actions logs (run 30276532671,
2026-07-27, representative of the last ~2 weeks):

| Domain | Elapsed | Long pole |
|---|---|---|
| markets | 30.2s | 49 tickers over 2 Finnhub workers + 13 serial FMP quotes (1s pacing) + post-phase (econ 8 FMP calls @1s, sentiment, market news) |
| sports | 19.7s | 18 ESPN calls at a self-imposed ≥1s interval + 0.3s/league |
| news | 11.2s | 10 NYT calls with 1.1s sleeps |
| media | 2.9s | Spotify only (Reddit 403-disabled) |
| **Total (parallel)** | **30.2s** | markets is the critical path |

The ETL *step* has been 28–31s on every recent run; total job time (61–75s typical) is
checkout + Python setup + `pip install` overhead, which section 0.9 (slim deps) shrinks.
The CLAUDE.md <60s requirement is currently being met.

Known conditions that would blow the budget:
- **Fewer than 2 distinct Alpha Vantage keys.** 10 sentiment topics are split across keys;
  the AV limiter allows 5 calls/min/key. With ≥2 keys no one sleeps; with 1 key the limiter
  sleeps ~60s mid-run (→ ~90s total). Note: `ALPHA_VANTAGE_API_KEY` (unsuffixed) is **empty**
  in the workflow env — only `_1`/`_2` are set. Preflight validation (0.7) should assert ≥2
  distinct AV keys.
- Lock-held rate-limiter sleeps (ESPN/NYT/FMP) cost nothing today because each module has a
  single serial caller in the daily run, but any added concurrency re-introduces the
  historical serialization hang — fix per 0.8.
- No retries means failures are at least *fast* — but a hung endpoint burns its 10–15s
  timeout per call with no circuit breaker.

Two silent failures visible in that same "all green" run, proving the Phase 0 case:
`sentiment=0` (all 10 AV topic calls returned nothing — swallowed `Note`/`Information`
responses) and `reddit=0` (403 kill-switch tripped), both reported as `[ OK ]`.

---

## Phase 1 — Scheduling cadence + a site that refreshes itself

### 1.1 [DONE — `cb53b10`, `run_quick_refresh.py` + `.github/workflows/intraday-refresh.yml`] Tiered refresh schedule, driven by per-API budgets
Real data cadence today is ~24h. Which sources can refresh often is dictated by daily caps
(from `docs/RATE_LIMITS.md`, verified against the fetcher code):

| API | Limit | Verdict |
|---|---|---|
| ESPN (unofficial) | none known; self-throttled 1s | **unrestricted** |
| Finnhub | 60/min/key × 2 keys, **no daily cap** | **unrestricted** (per-minute only) |
| Spotify | effectively none | unrestricted, but content changes weekly |
| NYT | 500/day/key × 2, 5/min/key | ~1000/day → hourly is trivial |
| Reddit (unauth) | informal 60/min, 403-prone | hourly at best; needs OAuth to be reliable |
| FMP | **250/day total** | scarce — ration it |
| Alpha Vantage | **25/day/key (~50–75)** | daily only |

**Tier A — every 15 min** (single new workflow, concurrency-guarded), ~48 calls/run, ~15s:
- Finnhub quotes: 10 stocks + 23 ETFs + 3 crypto = 36 calls (no daily cap; 36 calls/run is
  far under the 120/min two-key ceiling)
- ESPN scoreboards: 9 calls
- Finnhub market news: 3 calls

**Tier B — hourly, ~06:00–20:00 ET (14 runs/day):**
- NYT top stories: 10 calls → 140/day vs 1000 budget
- ESPN news: 9 calls
- FMP forex + commodity quotes: 13 calls → 182/day, leaving ~60/day headroom under the
  250 cap after econ's 8. **These 13 FMP calls must stay out of Tier A** — at 15-min cadence
  they'd need ~1,250/day. `run_quick_refresh.py` currently includes them (it quotes every
  basket ticker); add an asset-type filter.
- ~~Reddit hot posts: 8 calls (after moving to OAuth; skip until then)~~ — moot: the Reddit
  fetcher was removed entirely (`2f36005`, the day after this section was written), not just
  paused pending OAuth.

**Tier C — daily (the existing job, unchanged cadence):**
- AV sentiment (10 calls), FMP economic indicators (8), Spotify new releases (2),
  full company-news sweep.

Implementation: parameterize the quick-refresh entry point by tier
(`--tier a|b`), one new workflow with two cron expressions, shared `concurrency` group with
the daily job, and per-tier rows in `etl_runs`. Tier A keeps the site's quotes and scores at
most 15 minutes stale — which is what makes the auto-refreshing ticker (1.3) meaningful.

### 1.2 [DONE — `cb53b10`] Rework the admin ETL trigger (it can't work on Vercel either)
`POST /api/etl` also spawns Python via `execFile` — same fundamental problem as the cron route.

**Action:** the button should call the GitHub API (`workflow_dispatch` on `daily-etl.yml` /
quick-refresh workflow) with a fine-grained repo token, then poll `etl_runs` for status. Async
job model instead of blocking an HTTP response for minutes; after completion, call
`router.refresh()` (today the button never refreshes, so even a successful run leaves stale
data on screen until manual reload).

### 1.3 Auto-refreshing ticker
`NewsTickerClient` is `"use client"` with zero hooks — a static server snapshot animated by
CSS. It never updates without a full navigation.

**Action:**
- Move ticker data behind a small route handler (or direct anon Supabase query) and poll every
  60s while the tab is visible (`document.visibilityState` + `setInterval`, or SWR with
  `refreshInterval`); animate value/color transitions on change.
- Fix the loop-seam bug: items are **tripled** but the keyframe translates `-50%` (lands 1.5
  copies in). Two copies + `-50%` seams cleanly.
- Apply the existing-but-unused `.pause-on-hover` class; add `prefers-reduced-motion` fallback
  and `aria-hidden` on duplicate copies.

### 1.4 Cache + revalidate-on-ETL instead of "dynamic everything"
Because every page awaits `cookies()`, **all pages are fully dynamic and nothing is cached** —
the homepage re-runs ~25–30 Supabase round trips per request for data that changes at most a
few times a day.

**Action:** split data fetching from auth: wrap data queries in `unstable_cache`/`cacheTag`-ged
functions (auth stays dynamic in the layout), and have the ETL call a
`POST /api/revalidate?tag=…` webhook (secret-protected) as its last step. Pages then serve
cached data instantly and update within seconds of an ETL finishing.

### 1.5 Live updates for logged-in users
**Action (pick one, in order of simplicity):**
1. Poll + `router.refresh()` every N minutes while the tab is visible — trivial and fits the
   server-component architecture.
2. Supabase Realtime `postgres_changes` subscriptions on `stock_quotes` / `sports_scores` for
   logged-in users — true push, worth it once the intraday cadence (1.1) exists.

### 1.6 Freshness honesty everywhere
- Wire the header "Live" dot to `etl_runs` recency (green &lt; 2h, amber &lt; 26h, red otherwise).
- "As of HH:MM" stamps on markets (selects `fetched_at` but never renders it), media
  (`posted_at` never shown), sports, and every homepage card.
- Remove the false "FINNHUB · ALPHA VANTAGE · **REAL-TIME QUOTES**" / "live quotes" claims on
  `/markets` until 1.1+1.3 land, then re-add accurately ("updated every 30 min").

---

### 1.7 Daily database cleanup (retention job)
Nothing prunes data today — `supabase/05_prune.sql` drops unused *indexes*, not rows. Two
growth problems: news-type tables accumulate forever, and once Tier A ships, `stock_quotes`
goes from 1 row/ticker/day to ~40 (each 15-min fetch gets a new `quote_timestamp`, so the
`(stock_id, quote_timestamp)` upsert inserts rather than replaces).

**Status: [DONE]** — `info_agg.cleanup_daily()` is defined in `supabase/01_schema.sql` (not the
separate `07_retention.sql` this section originally pointed at — that file was folded in and
deleted, `f4a413d`, same day). It applies the retention policy and returns a jsonb report of
rows deleted per table, and is wired into `daily-etl.yml` via `--cleanup`. The policy:

| Table | Timestamp used | Policy |
|---|---|---|
| `stock_quotes` | `quote_timestamp` | **Collapse intraday → EOD:** for days before today (ET), keep only the latest quote per `(stock_id, day)`, delete the rest. Optionally cap history at ~400 days. |
| `news_articles` | `coalesce(fetched_at, published_at)` | delete > 30 days |
| `company_news` | same | delete > 30 days (fetcher only looks back 7 days, so nothing older is ever re-fetched) |
| `market_news` | same | delete > 30 days |
| `news_sentiment` | same | delete > 90 days (own knob `p_sentiment_days`: ~320 rows/day at ~1.2 kB is the largest table by volume) |
| `sports_news` | same | delete > 30 days |
| `sports_scores` | `game_date` | keep forever (small rows; team pages compute season records from them, and a 30-day window silently truncated every record) |
| `economic_indicators` | — | keep forever (tiny, historical value) |
| `etl_runs` (0.2) | `started_at` | keep 90 days |

Intraday-collapse core (the only non-trivial delete):

```sql
DELETE FROM info_agg.stock_quotes q
USING (
  SELECT stock_id,
         (quote_timestamp AT TIME ZONE 'America/New_York')::date AS day,
         MAX(quote_timestamp) AS keep_ts
  FROM info_agg.stock_quotes
  WHERE quote_timestamp < date_trunc('day', now() AT TIME ZONE 'America/New_York')
  GROUP BY 1, 2
) keep
WHERE q.stock_id = keep.stock_id
  AND (q.quote_timestamp AT TIME ZONE 'America/New_York')::date = keep.day
  AND q.quote_timestamp <> keep.keep_ts;
```

**Scheduling — build it into the existing daily job (recommended):** add a final step to
`daily-etl.yml` that calls `supabase.rpc('cleanup_daily')` and logs the returned report (and,
once 0.2 exists, records it in `etl_runs`). The daily cron fires at 12:05 UTC = 7–8am ET,
before market open, so "days before today" is always a complete trading day — no separate
scheduler, and cleanup failures surface in the same Actions run as everything else.
*Alternative:* schedule the same function inside Supabase with `pg_cron`
(`cron.schedule('cleanup', '0 6 * * *', $$SELECT info_agg.cleanup_daily()$$)`) — survives
Actions outages but is invisible to the ETL's logs; fine to add later as a belt-and-braces
backstop since both paths call the same function.

Guardrails: the function takes the retention windows as arguments with the defaults above
(one place to tune); the workflow step fails loudly if the RPC errors; and the report lets
the honest-exit-code logic (0.3) flag anomalies like a table losing 100% of its rows. The
`(quote_timestamp)` index that `05_prune.sql` dropped is re-added by `07_retention.sql` —
index maintenance at this insert volume is negligible, so the collapse and history-cap
deletes stay index-backed as the table grows under the intraday cadence.

---

## Phase 2 — Design, density, and correctness of states

### 2.1 Error/empty/loading states
- Add `error.tsx` (and `global-error.tsx`) — there are none; any server throw shows the default
  Next.js crash screen.
- Stop conflating outage with emptiness: every fetcher swallows exceptions into `[]`, and
  `/sports`/`/markets`/`/media` don't even check `.error`. Surface a "data temporarily
  unavailable" state distinct from "no data yet".
- Rewrite empty-state copy — public visitors currently see literal
  `python src/api/run_etl.py --markets-only` instructions.
- On the homepage every card is hidden behind `.length > 0`, so a failed domain silently
  vanishes; render a compact placeholder instead.
- Fix skeleton mismatches: `(public)/loading.tsx` uses a grid while the page uses masonry;
  `markets/loading.tsx` renders only `hidden md:grid` rows, so the mobile loading state is
  blank.

### 2.2 Layout mechanics
- Replace `MasonryColumns`' window-width JS (renders 1 column on SSR, then jumps to 5 — a
  guaranteed layout shift on every desktop load, re-rendering on every un-debounced resize)
  with CSS `columns`/container queries, or height-aware balancing.
- Extract the ~500 lines of lookup tables inlined in `page.tsx` (`TEAM_ABBREVS`,
  `HUB_CAP_COLORS`, …) into data modules.
- Consolidate homepage queries: 7 separate `getLeagueSnapshot` calls each doing its own league
  lookup → one query grouped in JS, or a Postgres view/RPC. Target &lt; 8 round trips.

### 2.3 Visual consistency
- Accent colors are defined twice: CSS vars (with dark-mode variants, mostly unused) and ~40
  hardcoded inline `hsl(...)` literals (which don't shift for dark mode). Standardize on the
  CSS vars — this fixes dark-mode accents for free.
- Shared `PageHeader` component (the header block is copy-pasted across 4 domain pages) and a
  shared density scale — the homepage runs 7–10px mono type while domain pages run
  `text-sm`/`px-6 py-6`; pick intentional "dense" vs "reading" registers.
- Active-route highlighting in the nav (currently hover-only underline).
- Sparklines in the markets table rows and homepage stock cards — `SparklineChart` exists but
  now has **zero usages anywhere** in `app/`/`components/` (worse than "used on exactly one
  page" — it's since been removed from that page too); give it a no-data fallback (it
  currently returns `null`) if it gets wired back in.

### 2.4 Mobile + accessibility
- Only 34 breakpoint utilities exist in the whole codebase; the nav relies on `overflow-x-auto`
  (an unused `hamburger-icon.tsx` already exists). Do a real mobile pass.
- `prefers-reduced-motion` guard for the ~8 infinite animations; `aria-expanded`/`aria-controls`
  on collapsible cards; `next/image` for external article images (currently raw `<img>` with
  no dimensions → CLS).

### 2.5 Cleanup
- Delete Supabase-starter leftovers (`components/tutorial/*`, `deploy-button`, `hero`, logos,
  `env-var-warning`), unused animations, unreferenced icons; fix `expandable-section.tsx`'s
  raw Tailwind grays that ignore dark mode.
- ETL side: add `__init__.py` package structure (kill the 7 `sys.path.insert` hacks), dedupe
  the three quote-row shapers, fix the mutable default arg in `sync_market_news`, dedupe
  `sports_scores` rows before upsert (only table not deduped against its conflict key),
  paginate the unbounded `stocks` read in `insert_news_sentiment`.
- ~~Fix doc drift: RUNBOOK points at moved/renamed files...~~ — `[DONE]` as of the doc audit
  that updated `CLAUDE.md`, `README.md`, `src/api/README.md`, and everything under
  `src/api/docs/` to match current code (parallel execution, GitHub Actions scheduling,
  archived/broken seed script, current flag set, corrected function/line references in
  `DEDUPLICATION.md`). Re-audit periodically — this class of drift recurs whenever code moves
  without a doc pass.

---

## Suggested sequencing

| Milestone | Contents | Outcome |
|---|---|---|
| 1 (ETL trust) | 0.1–0.4, 0.6 | One scheduler, runs recorded, failures visible and honest |
| 2 (ETL hardening) | 0.5, 0.7–0.9 | Transient errors survive, fast slim CI installs |
| 3 (Freshness) | 1.1–1.7 | Intraday data, live ticker, revalidate-on-ETL, honest labels, daily retention cleanup |
| 4 (States + layout) | 2.1, 2.2 | Error/empty/loading correctness, no layout shift, fewer queries |
| 5 (Polish) | 2.3–2.5 | Consistent design system, mobile, a11y, dead-code removal |

Milestones 1–2 are prerequisites for everything user-facing: an auto-refreshing ticker over a
pipeline that silently fails just refreshes stale data faster.
