# Daily ETL Execution Order & Timing

`python src/api/run_etl.py` — wall time ~40–45s (gated by markets)

---

## Top Level: 4 domains launch simultaneously

```
t=0s  ┌─────────────┬─────────────┬─────────────┬─────────────┐
      │  SPORTS     │  MARKETS    │  NEWS       │  MEDIA      │
      │ ~15–20s     │ ~40–45s*    │ ~10–15s     │ ~10–15s     │
      └─────────────┴─────────────┴─────────────┴─────────────┘
```

`run_full_etl()` submits all 4 to a `ThreadPoolExecutor` and waits for all to finish. Wall time = slowest domain (markets).

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

## MARKETS (~40–45s, sequential steps)*

This is the bottleneck that sets overall wall time:

```
Step 1 — Ticker quotes + company news, max 5 tickers concurrent:
  ~50 tickers / 5 workers = 10 batches × ~1.5s ≈ 15s
  (ETFs/crypto/forex/commodity: quote only; stocks: quote + Finnhub news)

Step 2 — Market news (Finnhub), 3 categories sequential:
  general → forex → crypto ≈ 3s

Step 3 — AV sentiment, 10 topics sequential (1 AV call each):
  ~2s/topic × 10 ≈ 20s  ← primary bottleneck when AV keys have capacity

Step 4 — Economic indicators (FMP): ~2–3s

Total: ~38–43s (missing-profile FMP backfill no longer in daily ETL)
```

---

## Notes

- `--skip-sentiment` drops markets to ~20s, reducing total wall time to ~20s
- AV sentiment exhausts the free-tier daily limit (25 req/key) quickly if keys have been used earlier in the day — the daily run should be the **first** AV consumer each day
- Supabase writes are capped at 5 concurrent threads (markets) and 3 (NYT) to avoid HTTP/2 connection exhaustion
