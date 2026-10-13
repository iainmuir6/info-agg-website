# API Rate Limits


| Domain  | API               | Env Var(s)                                  | Keys | Req/min      | Req/day               | Implementation                                                                                           | Active Endpoints                                                                                                                             |
| ------- | ----------------- | ------------------------------------------- | ---- | ------------ | --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sports  | ESPN (unofficial) | —                                           | 0    | Unknown      | Unknown               | No limiter; 1 call/sport/league per run (+1 more per league for standings, daily-only via `--season-schedules`) | `GET /apis/site/v2/sports/{sport}/{league}/news` · `/scoreboard` · `GET /apis/v2/sports/{sport}/{league}/standings`                          |
| Markets | Finnhub           | `FINNHUB_API_KEY_1` `FINNHUB_API_KEY_2`   | 2    | 60/key       | None                  | Per-key sliding-window `_fh_rate_limit(key)` + module-level `>=1s` minimum between requests; round-robin key selection with `max_workers=2` | `GET /quote` · `/stock/profile2` · `/company-news` · `/news`                                                                                 |
| Markets | FMP               | `FMP_API_KEY`                               | 1    | None         | **250**               | Daily counter `_fmp_rate_check()` (thread-safe) + module-level `>=1s` minimum between requests | `GET /stable/quote` (commodities) · `/treasury-rates` · `/economic-indicators`                                              |
| News    | NYT               | `NYT_API_KEY_1` `NYT_API_KEY_2`            | 2    | 5/key        | 500                   | Daily run switches keys after 5 requests: first 5 top-stories calls on key1, next 5 calls on key2; `>=1s` minimum between NYT HTTP calls; batch upsert after all sections | `GET /topstories/v2/{section}.json` (9 sections) · `/mostpopular/v2/viewed/{period}.json`                                                   |
| Media   | YouTube Data v3   | `YOUTUBE_API_KEY`                           | 1    | None         | **10,000 units**      | No limiter needed; 1 call/run, 1 unit cost                                                                | `GET /youtube/v3/videos?chart=mostPopular`                                                                                                   |
| Markets | Frankfurter       | —                                           | 0    | None         | None                  | Keyless (ECB reference rates). **One request covers all 10 pairs** — replaced 10 FMP `/quote` calls per Tier B run. Published once per business day, so forex no longer moves intraday | `GET /v1/{start}..{end}?base=USD&symbols=…`                                                                                                  |
| Markets | FRED              | —                                           | 0    | None         | None                  | Keyless public CSV export; 1 call/run, daily only. Real GDP (`GDPC1`, stored as `realGDP`) moved here when FMP's `/economic-indicators` started returning `[]` for it | `GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDPC1` |
| Misc    | Visual Crossing   | `WEATHER_API_KEY`                           | 1    | None         | **1,000 records/day** | No limiter; billed per *day of data returned*, so cost is cities x `FORECAST_DAYS` (**6 x 5 = 30/run**, daily only) | `GET /VisualCrossingWebServices/rest/services/timeline/{location}/{start}/{end}`                                                             |
| Misc    | Calendarific      | `CALENDAR_API_KEY`                          | 1    | None         | **500/month**         | No limiter; 1 call/run on the daily run only (~30/month)                                                  | `GET /api/v2/holidays`                                                                                                                       |
| Misc    | REST Countries v5 | `COUNTRIES_API_KEY`                         | 1    | None         | **1,000/MONTH**       | **Per-month, not per-day.** 1 call/run, and `_country_is_current()` skips the fetch entirely when today's rotation pick is already stored — so a re-dispatched daily run costs nothing. ~30/month | `GET /countries/v5/codes.alpha_2/{code}`                                                                                                     |
| Misc    | Wikipedia REST    | —                                           | 0    | None         | None                  | Keyless; 1 call/run                                                                                       | `GET /api/rest_v1/page/random/summary`                                                                                                       |
| Misc    | Merriam-Webster   | —                                           | 0    | None         | None                  | Keyless RSS; 1 call/run                                                                                   | `GET /wotd/feed/rss2`                                                                                                                        |
| Misc    | uselessfacts      | —                                           | 0    | None         | None                  | Keyless; 1 call/run                                                                                       | `GET /random.json`                                                                                                                           |
| Summary | Google Gemini     | `GEMINI_API_KEY`                            | 1    | 15           | **~1,500**            | No limiter needed — **at most 2 calls/day** (daily briefing + weekly on the first run of an ISO week), both freshness-gated. Availability, not quota, is the constraint: models are tried in order of responsiveness with a 12s cap and the domain has a 30s ceiling | `POST /v1beta/models/{model}:generateContent`                                                                                                 |

**Forex moved to Frankfurter.** Tier B used to spend 13 FMP calls a run — 10 forex pairs plus 3
commodities — which at 6 runs a day was 78 of the 250/day cap. Frankfurter serves all 10 pairs in
one keyless request, so Tier B now costs 3 FMP calls (commodities only): 18/day instead of 78.
The trade-off is granularity — ECB publishes a daily reference rate, so forex rows change once per
business day however often the tiers run. Commodities stay on FMP because there is no ECB
equivalent.

Spotify (playlists, Top Podcasts) and Reddit (removed) are not in this table — Spotify is live-embedded via `<iframe>` on the frontend with no backend fetch or rate limit to manage.

`MinInterval` (`etl_lib.py`) is the shared slot-reservation primitive behind the "global gap"
rows above (Finnhub, FMP, NYT): it reserves the next allowed timestamp under a lock, then
releases the lock *before* sleeping — the historical ETL hang was a global limiter that slept
while still holding its lock, serializing every parallel worker behind it (see the ETL
Performance Requirement in the repo root `CLAUDE.md`).

**Circuit breaker.** All of the endpoints above also sit behind a shared `EndpointBreaker`
(`etl_lib.py`) that trips after 3 consecutive failures on a given endpoint and short-circuits
further calls to it for the rest of the run, independent of the rate limiter. Wired into
Finnhub, NYT, ESPN, and FMP.

NYT top stories registers under a **per-key** endpoint id (`nyt:topstories:key1/key2`). Its
sections are split across keys and worked by one thread each, so a single shared counter let
three unrelated blips spread over *both* workers trip the endpoint and skip every remaining
section — one tier-B run wrote 0 articles that way.

ESPN scoreboards register under **two** ids and check both: the shared `espn:scoreboard` carries
host-level faults (connection errors, timeouts, 5xx, 429 — `etl_lib.is_host_fault()`), so a real
ESPN outage still costs one timeout rather than one per league; `espn:scoreboard:{sport}/{league}`
carries that league's own 4xx, which says nothing about the other eight and must not skip them.

**NYT transient 404s.** `topstories/v2/{section}.json` intermittently returns 404 for a section
that exists and answers 200 seconds later (observed live for `insider`). The shared HTTP session
deliberately does not retry 404, so `fetch_nyt_top_stories` retries that status once itself.

**Secret redaction.** `requests` puts the full request URL — query string and API key included —
into its exception strings, and every fetcher prints those. `etl_lib.install_secret_redaction()`
wraps `stdout`/`stderr` at import so `?api-key=…`-style credentials are scrubbed from every
printed line, and `EndpointBreaker` redacts before truncating its stored reason (truncating
mid-key had been slipping a usable key prefix past GitHub Actions' secret masking, which only
matches the whole value). `finish_etl_run` redacts the same patterns out of `etl_runs`.


## Daily Budget Summary


| API           | Keys | Budget      | Daily ETL usage                                               | Headroom |
| ------------- | ---- | ----------- | ------------------------------------------------------------- | -------- |
| FMP           | 1    | 250 req/day | 28 (6 Tier B × 3 commodity quotes + the daily's 10: 3 commodities + treasury + 6 macro) | +222 |
| NYT           | 2    | 500 req/day | 10 (9 top-stories sections + most-popular)                               | +490     |
| Finnhub       | 2    | 120 req/min | ~100–150/run (quotes + news, 2 workers)                       | —        |
| ESPN          | —    | Unknown     | 18 calls/run (9 leagues × news + scores), +9 on `--season-schedules` (standings) | —        |
| YouTube       | —    | 10,000/day  | 1 call/run                                                    | +9,999   |
| Visual Crossing | 1  | 1,000/day (records) | 30/run (6 cities × 5 forecast days), daily run only  | +970     |
| Calendarific  | 1    | 500/month   | ~30/month (1/day)                                             | +470     |
| REST Countries | 1   | **1,000/month** | ~30/month (1/day, skipped when already current)           | +970     |
| Gemini        | 1    | ~1,500/day  | **≤2/day** (1 daily briefing + 1 weekly per ISO week)         | +1,498   |

**REST Countries is the one budget here measured per month.** At 1 call a day the daily run uses
3% of it, but the daily workflow is manually dispatchable from `/dashboard` and every re-run
would spend another request for a card that only changes once a day — hence the
`_country_is_current()` guard in `misc_db_helper.py`, which caps it at one fetch per calendar
day no matter how often the run fires. `fetch_all_countries()` paginates at 100/page (3 requests
for all 254) and is **not** called by the ETL; it exists for one-off use.

## Google Gemini (AI briefings)

| | |
|---|---|
| Key | `GEMINI_API_KEY` (AI Studio — https://aistudio.google.com/apikey) |
| Free tier | ~1,500 requests/day · 15 RPM · 1M TPM |
| Daily run spends | **at most 2** (one daily briefing, plus one weekly on the first run of an ISO week) |

Quota is not the constraint here and never will be at two calls a day — **availability** is. The
headline Flash models are frequently capacity-limited on the free tier: measured 2026-09-01,
`gemini-3.7-flash` took 29.6s to return a 503 and `gemini-flash-latest` timed out at 30s, while the
lite models answered in under a second.

`summary/gemini.py` is built around that. It tries a list of models ordered by **responsiveness
rather than capability**, falls through on 404/429/503 (model-specific faults) but not on 4xx
(request faults, which would fail identically everywhere), and caps each request at 12s. The
domain as a whole is capped at `SUMMARY_BUDGET_S` (30s), and the weekly briefing is deferred to
the next run if the daily one has already spent it — the <60s run requirement wins over a
same-day weekly refresh.

Measured worst case (both briefings generating from scratch): **6.7s**.
