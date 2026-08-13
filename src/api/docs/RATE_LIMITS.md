# API Rate Limits


| Domain  | API               | Env Var(s)                                  | Keys | Req/min      | Req/day               | Implementation                                                                                           | Active Endpoints                                                                                                                             |
| ------- | ----------------- | ------------------------------------------- | ---- | ------------ | --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sports  | ESPN (unofficial) | —                                           | 0    | Unknown      | Unknown               | No limiter; 1 call/sport/league per run (+1 more per league for standings, daily-only via `--season-schedules`) | `GET /apis/site/v2/sports/{sport}/{league}/news` · `/scoreboard` · `GET /apis/v2/sports/{sport}/{league}/standings`                          |
| Markets | Finnhub           | `FINNHUB_API_KEY_1` `FINNHUB_API_KEY_2`   | 2    | 60/key       | None                  | Per-key sliding-window `_fh_rate_limit(key)` + module-level `>=1s` minimum between requests; round-robin key selection with `max_workers=2` | `GET /quote` · `/stock/profile2` · `/company-news` · `/news`                                                                                 |
| Markets | Alpha Vantage     | `ALPHA_VANTAGE_API_KEY_1` `_2` `_3`         | 3    | 5/key        | **25/key (75 total)** | Per-key sliding-window `_av_rate_limit(key)` **plus a global `MinInterval` slot reservation (>=1.25s gap) across all keys** — AV throttles bursts by IP, not only by key, and answers with an `Information` body instead of data; round-robin rotation; key rotates on rate-limit error | `GET /query?function=NEWS_SENTIMENT&topics={topic}` (10×/daily) · `TIME_SERIES_DAILY` · `DIGITAL_CURRENCY_DAILY` · `ETF_PROFILE` (seed only) |
| Markets | FMP               | `FMP_API_KEY`                               | 1    | None         | **250**               | Daily counter `_fmp_rate_check()` (thread-safe) + module-level `>=1s` minimum between requests | `GET /stable/profile` · `/quote` (forex+commodity) · `/treasury-rates` · `/economic-indicators`                                              |
| News    | NYT               | `NYT_API_KEY_1` `NYT_API_KEY_2`            | 2    | 5/key        | 500                   | Daily run switches keys after 5 requests: first 5 top-stories calls on key1, next 5 calls on key2; `>=1s` minimum between NYT HTTP calls; batch upsert after all sections | `GET /topstories/v2/{section}.json` (9 sections) · `/mostpopular/v2/viewed/{period}.json`                                                   |
| Media   | YouTube Data v3   | `YOUTUBE_API_KEY`                           | 1    | None         | **10,000 units**      | No limiter needed; 1 call/run, 1 unit cost                                                                | `GET /youtube/v3/videos?chart=mostPopular`                                                                                                   |

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


## Daily Budget Summary


| API           | Keys | Budget      | Daily ETL usage                                               | Headroom |
| ------------- | ---- | ----------- | ------------------------------------------------------------- | -------- |
| Alpha Vantage | 3    | 75 req/day  | 10 (sentiment topics)                                         | +65      |
| FMP           | 1    | 250 req/day | ~21–121 (profiles + forex/commodity quotes + treasury + econ) | ~129–229 |
| NYT           | 2    | 500 req/day | 10 (9 top-stories sections + most-popular)                               | +490     |
| Finnhub       | 2    | 120 req/min | ~100–150/run (quotes + news, 2 workers)                       | —        |
| ESPN          | —    | Unknown     | 18 calls/run (9 leagues × news + scores), +9 on `--season-schedules` (standings) | —        |
| YouTube       | —    | 10,000/day  | 1 call/run                                                    | +9,999   |


