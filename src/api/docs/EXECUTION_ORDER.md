# Daily ETL Execution Order & Timing

`python src/api/run_etl.py` — wall time well under 60s (cooperative budget defaults to 50s;
see the ETL Performance Requirement in the repo root `CLAUDE.md`), gated by markets.

---

## Top Level: 4 domains launch simultaneously

```
t=0s  ┌─────────────┬─────────────┬─────────────┬─────────────┐
      │  SPORTS     │  MARKETS    │  NEWS       │  MEDIA      │
      │ fastest     │ slowest —   │ mid         │ fastest     │
      │             │ gates total │             │             │
      └─────────────┴─────────────┴─────────────┴─────────────┘
```

`run_full_etl()` submits all 4 to a `ThreadPoolExecutor` and waits for all to finish. Wall time
= slowest domain (markets, driven by NYT's ~1s/section pacing × 9 sections and AV sentiment).
Each domain also has its own `--budget-seconds` cooperative ceiling (default 50s per phase; see
`run_etl.py --budget-seconds`) — a domain stops starting new work once its budget is spent
rather than running unbounded, which is what keeps the overall run well under the 60s
requirement in the repo root `CLAUDE.md`. Exact per-domain timings vary with network latency
and API response time and aren't reproduced here as fixed numbers.

---

## SPORTS (~15–20s, sequential)

`sync_all_sports_data()` has no thread pool — iterates over all 9 leagues one by one:

```
football/nfl → college-football → basketball/nba → wnba →
mens-college-basketball → baseball/mlb → college-baseball →
hockey/nhl → soccer/eng.1

Each league: fetch ESPN news → insert → fetch ESPN scores → insert
~1.5–2s per league × 9 leagues ≈ 15s
```

---

## NEWS (~10–20s, sequential)

```
Step 1 — NYT top stories (sequential, 9 sections):
  `run_etl.py` default sections:
  us → world → opinion → business → insider → realestate → science → technology → arts
  Minimum pacing: `time.sleep(1.1)` between section calls.

Step 2 — NYT most popular (1 call, after sections): uses `NYT_API_KEY_2` (daily: calls 5–10)

Total: ~10s+ (network + JSON parsing dependent)
```

---

## MEDIA (~1–2s)

```
Step 1 — YouTube trending videos (1 call): ~1–2s

Spotify (playlists, Top Podcasts) is live-embedded on the frontend — no ETL
step. Reddit was removed.

Total: ~1–2s
```

---

## MARKETS (bottleneck that sets overall wall time)

Two sequential phases, each internally parallel:

```
Phase A — Ticker quotes + company news, 2 concurrent workers
  (max_workers=2 — one per Finnhub key, not per ticker):
  ~36 tickers / 2 workers, threads make no DB calls; quotes and news are
  batch-upserted once after the pool drains, not per-ticker.
  (ETFs/crypto/forex/commodity: quote only; stocks: quote + Finnhub news)

Phase B — market news + AV sentiment + economic indicators, run in a SECOND
  ThreadPoolExecutor (max_workers = number of enabled steps), concurrently —
  each hits a different API (Finnhub / AV / FMP), so there's no contention:
    ├─ Market news (Finnhub), 4 categories
    ├─ AV sentiment — all 10 topics (no partial-topic mode; `--skip-sentiment`
    │    drops this step entirely, not just some topics)
    └─ Economic indicators (FMP treasury rates + 7 macro indicators)

Wall time = Phase A + max(Phase B steps), not the sum of every step.
```

---

## Notes

- `--skip-sentiment` removes the AV sentiment step from markets' Phase B entirely, shortening markets (and therefore the overall run, since markets gates it)
- AV sentiment exhausts the free-tier daily limit (25 req/key) quickly if keys have been used earlier in the day — the daily run should be the **first** AV consumer each day
- Markets' ticker-fetch phase is capped at 2 concurrent threads (one per Finnhub key, `max_workers=2`); markets' Phase B pool sizes itself to however many of market-news/sentiment/econ are enabled
