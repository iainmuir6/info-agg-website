# API Rate Limits


| Domain  | API               | Env Var(s)                                  | Keys | Req/min      | Req/day               | Implementation                                                                                           | Active Endpoints                                                                                                                             |
| ------- | ----------------- | ------------------------------------------- | ---- | ------------ | --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sports  | ESPN (unofficial) | —                                           | 0    | Unknown      | Unknown               | No limiter; 1 call/sport/league per run                                                                  | `GET /apis/site/v2/sports/{sport}/{league}/news` · `/scoreboard`                                                                             |
| Markets | Finnhub           | `FINNHUB_API_KEY_1` `FINNHUB_API_KEY_2`   | 2    | 60/key       | None                  | Per-key sliding-window `_fh_rate_limit(key)` + module-level `>=1s` minimum between requests; round-robin key selection with `max_workers=2` | `GET /quote` · `/stock/profile2` · `/company-news` · `/news`                                                                                 |
| Markets | Alpha Vantage     | `ALPHA_VANTAGE_API_KEY_1` `_2` `_3`         | 3    | 5/key        | **25/key (75 total)** | Per-key sliding-window `_av_rate_limit(key)`; round-robin rotation; key rotates on rate-limit error      | `GET /query?function=NEWS_SENTIMENT&topics={topic}` (10×/daily) · `TIME_SERIES_DAILY` · `DIGITAL_CURRENCY_DAILY` · `ETF_PROFILE` (seed only) |
| Markets | FMP               | `FMP_API_KEY`                               | 1    | None         | **250**               | Daily counter `_fmp_rate_check()` (thread-safe) + module-level `>=1s` minimum between requests | `GET /stable/profile` · `/quote` (forex+commodity) · `/treasury-rates` · `/economic-indicators`                                              |
| News    | NYT               | `NYT_API_KEY_1` `NYT_API_KEY_2`            | 2    | 5/key        | 500                   | Daily run switches keys after 5 requests: first 5 top-stories calls on key1, next 5 calls on key2; `>=1s` minimum between NYT HTTP calls; batch upsert after all sections | `GET /topstories/v2/{section}.json` (9 sections) · `/mostpopular/v2/viewed/{period}.json`                                                   |
| Media   | Spotify           | `SPOTIFY_CLIENT_ID` `SPOTIFY_CLIENT_SECRET` | 1    | ~1800 (30/s) | None                  | No limiter needed; 2 calls/run (token + releases)                                                        | `POST /api/token` · `GET /v1/browse/new-releases`                                                                                            |
| Media   | Reddit            | —                                           | 0    | 60           | None                  | Sequential fetch (unauthenticated; descriptive `User-Agent` required); batch upsert after all subreddits | `GET /r/{subreddit}/hot.json` (8 subreddits)                                                                                                 |


## Daily Budget Summary


| API           | Keys | Budget      | Daily ETL usage                                               | Headroom |
| ------------- | ---- | ----------- | ------------------------------------------------------------- | -------- |
| Alpha Vantage | 3    | 75 req/day  | 10 (sentiment topics)                                         | +65      |
| FMP           | 1    | 250 req/day | ~21–121 (profiles + forex/commodity quotes + treasury + econ) | ~129–229 |
| NYT           | 2    | 500 req/day | 10 (9 top-stories sections + most-popular)                               | +490     |
| Finnhub       | 2    | 120 req/min | ~100–150/run (quotes + news, 2 workers)                       | —        |
| ESPN          | —    | Unknown     | 18 calls/run (9 leagues × news + scores)                      | —        |
| Spotify       | —    | None        | 2 calls/run                                                   | —        |
| Reddit        | —    | None        | 8 calls/run                                                   | —        |


