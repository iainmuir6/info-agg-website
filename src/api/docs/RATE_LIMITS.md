# API Rate Limits


| Domain  | API               | Env Var(s)                                  | Keys | Req/min      | Req/day               | Implementation                                                                                           | Active Endpoints                                                                                                                             |
| ------- | ----------------- | ------------------------------------------- | ---- | ------------ | --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sports  | ESPN (unofficial) | —                                           | 0    | Unknown      | Unknown               | No limiter; 1 call/sport/league per run (+1 more per league for standings, daily-only via `--season-schedules`) | `GET /apis/site/v2/sports/{sport}/{league}/news` · `/scoreboard` · `GET /apis/v2/sports/{sport}/{league}/standings`                          |
| Markets | Finnhub           | `FINNHUB_API_KEY_1` `FINNHUB_API_KEY_2`   | 2    | 60/key       | None                  | Per-key sliding-window `_fh_rate_limit(key)` + module-level `>=1s` minimum between requests; round-robin key selection with `max_workers=2` | `GET /quote` · `/stock/profile2` · `/company-news` · `/news`                                                                                 |
| Markets | Alpha Vantage     | `ALPHA_VANTAGE_API_KEY_1` `_2` `_3`         | 3    | 5/key        | **25/key (75 total)** | Per-key sliding-window `_av_rate_limit(key)` **plus a global `MinInterval` slot reservation (>=1.25s gap) across all keys** — AV throttles bursts by IP, not only by key, and answers with an `Information` body instead of data; round-robin rotation; key rotates on rate-limit error | `GET /query?function=NEWS_SENTIMENT&topics={topic}` (10×/daily) · `TIME_SERIES_DAILY` · `DIGITAL_CURRENCY_DAILY` · `ETF_PROFILE` (seed only) |
| Markets | FMP               | `FMP_API_KEY`                               | 1    | None         | **250**               | Daily counter `_fmp_rate_check()` (thread-safe) + module-level `>=1s` minimum between requests | `GET /stable/profile` · `/quote` (forex+commodity) · `/treasury-rates` · `/economic-indicators`                                              |
| News    | NYT               | `NYT_API_KEY_1` `NYT_API_KEY_2`            | 2    | 5/key        | 500                   | Daily run switches keys after 5 requests: first 5 top-stories calls on key1, next 5 calls on key2; `>=1s` minimum between NYT HTTP calls; batch upsert after all sections | `GET /topstories/v2/{section}.json` (9 sections) · `/mostpopular/v2/viewed/{period}.json`                                                   |
| Media   | YouTube Data v3   | `YOUTUBE_API_KEY`                           | 1    | None         | **10,000 units**      | No limiter needed; 1 call/run, 1 unit cost                                                                | `GET /youtube/v3/videos?chart=mostPopular`                                                                                                   |
| Misc    | Visual Crossing   | `WEATHER_API_KEY`                           | 1    | None         | **1,000 records/day** | No limiter; billed per *day of data returned*, so cost is cities x `FORECAST_DAYS` (4 x 5 = 20/run, daily only) | `GET /VisualCrossingWebServices/rest/services/timeline/{location}/{start}/{end}`                                                             |
| Misc    | Calendarific      | `CALENDAR_API_KEY`                          | 1    | None         | **500/month**         | No limiter; 1 call/run on the daily run only (~30/month)                                                  | `GET /api/v2/holidays`                                                                                                                       |
| Misc    | REST Countries v5 | `COUNTRIES_API_KEY`                         | 1    | None         | **1,000/MONTH**       | **Per-month, not per-day.** 1 call/run, and `_country_is_current()` skips the fetch entirely when today's rotation pick is already stored — so a re-dispatched daily run costs nothing. ~30/month | `GET /countries/v5/codes.alpha_2/{code}`                                                                                                     |
| Misc    | Wikipedia REST    | —                                           | 0    | None         | None                  | Keyless; 1 call/run                                                                                       | `GET /api/rest_v1/page/random/summary`                                                                                                       |
| Misc    | Merriam-Webster   | —                                           | 0    | None         | None                  | Keyless RSS; 1 call/run                                                                                   | `GET /wotd/feed/rss2`                                                                                                                        |
| Misc    | uselessfacts      | —                                           | 0    | None         | None                  | Keyless; 1 call/run                                                                                       | `GET /random.json`                                                                                                                           |

`NEWS_SENTIMENT` is queried by topic with **no `tickers` filter**: AV ANDs the ticker list with
itself and with the topic, so a watchlist-sized list matched nothing and was rejected outright
with `Invalid inputs` past ~20 symbols. Per-article ticker relevance still arrives in each
article's `ticker_sentiment` payload. `MAX_SENTIMENT_TICKERS` in `alpha_vantage.py` enforces this.

Spotify (playlists, Top Podcasts) and Reddit (removed) are not in this table — Spotify is live-embedded via `<iframe>` on the frontend with no backend fetch or rate limit to manage.

`MinInterval` (`etl_lib.py`) is the shared slot-reservation primitive behind the "global gap"
rows above (AV, Finnhub, FMP, NYT): it reserves the next allowed timestamp under a lock, then
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
| Alpha Vantage | 3    | 75 req/day  | 10 (sentiment topics)                                         | +65      |
| FMP           | 1    | 250 req/day | ~21–121 (profiles + forex/commodity quotes + treasury + econ) | ~129–229 |
| NYT           | 2    | 500 req/day | 10 (9 top-stories sections + most-popular)                               | +490     |
| Finnhub       | 2    | 120 req/min | ~100–150/run (quotes + news, 2 workers)                       | —        |
| ESPN          | —    | Unknown     | 18 calls/run (9 leagues × news + scores), +9 on `--season-schedules` (standings) | —        |
| YouTube       | —    | 10,000/day  | 1 call/run                                                    | +9,999   |
| Visual Crossing | 1  | 1,000/day (records) | 20/run (4 cities × 5 forecast days), daily run only  | +980     |
| Calendarific  | 1    | 500/month   | ~30/month (1/day)                                             | +470     |
| REST Countries | 1   | **1,000/month** | ~30/month (1/day, skipped when already current)           | +970     |

**REST Countries is the one budget here measured per month.** At 1 call a day the daily run uses
3% of it, but the daily workflow is manually dispatchable from `/dashboard` and every re-run
would spend another request for a card that only changes once a day — hence the
`_country_is_current()` guard in `misc_db_helper.py`, which caps it at one fetch per calendar
day no matter how often the run fires. `fetch_all_countries()` paginates at 100/page (3 requests
for all 254) and is **not** called by the ETL; it exists for one-off use.


