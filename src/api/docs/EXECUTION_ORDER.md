# Daily ETL Execution Order & Timing

`python src/api/run_etl.py` — wall time well under 60s (cooperative budget defaults to 50s;
see the ETL Performance Requirement in the repo root `CLAUDE.md`), gated by sports.

---

## Top Level: 5 domains in parallel, then SUMMARY on its own

```
t=0s  ┌───────────┬───────────┬───────────┬───────────┬───────────┐
      │  SPORTS   │  MARKETS  │  NEWS     │  MEDIA    │  MISC     │
      │ slowest — │ mid       │ mid       │ fastest   │ fast      │
      │ gates it  │           │           │           │           │
      └───────────┴───────────┴───────────┴───────────┴───────────┘
                              ↓ all five joined
                        ┌───────────────┐
                        │   SUMMARY     │  sequential, last
                        └───────────────┘
```

`run_full_etl()` submits the five fetch domains to a `ThreadPoolExecutor` and waits for all to
finish. Wall time for that phase = slowest domain.

**SUMMARY is deliberately not in the pool.** It is the one domain with no upstream of its own —
its input is the rows the other five have just written — so running it alongside them would race
them and summarise yesterday's data. It runs after the join, and its cost lands directly on the
total, which is why it carries its own 30s ceiling (`SUMMARY_BUDGET_S`) and a 12s per-request
timeout. Measured: 6.7s when both briefings generate from scratch, 0.3s when both are already
current (the common case — they are freshness-gated, so a re-dispatched run regenerates nothing).

Observed totals: **18.4s** for a full daily run with the briefings current.
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

## MISC (~2–3s)

```
Six independent single-call feeds, each degrading on its own — a missing key is
a note, a dead upstream costs one card, and the domain never fails the run:

  weather (Visual Crossing, 6 cities)  ·  holidays (Calendarific)
  country of the day (REST Countries)  ·  word of the day (Merriam-Webster RSS)
  On This Day + random pages (Wikipedia)  ·  useless facts

Three are gated so a re-dispatched run costs no upstream requests:
  country   — skipped once today's rotation pick is stored (1,000/MONTH budget)
  wikipedia — one pick per calendar day, or the cards churn every run
  facts     — likewise
```

---

## SUMMARY (~0.3s current · ~6.7s regenerating, sequential and last)

```
Gate:  daily briefing  → once per EASTERN calendar day
       weekly briefing → once per ISO week
       (either already current → skipped, no Gemini call)

Build: context bundle from the DB — news, market news, biggest movers,
       completed games, plus scheduled games + upcoming holidays for the
       daily card's lookahead
  ↓
Call:  Gemini, structured JSON output, model list tried in order of
       RESPONSIVENESS (12s cap each, falls through on 404/429/503)
  ↓
Write: misc_content ('summary','day') / ('summary','week')
```

Never fails the run. On any error the stored row is left untouched, so the card serves the
previous briefing with a visible timestamp rather than emptying.

---

## MEDIA (~1–2s)

```
Step 1 — YouTube trending videos (1 call): ~1–2s

Spotify (playlists, Top Podcasts) is live-embedded on the frontend — no ETL
step. Reddit was removed.

Total: ~1–2s
```

---

## MARKETS (~13s)

> **Which domain gates the run has changed.** Markets used to set wall time on its own; moving
> forex to Frankfurter (one keyless request for all 10 pairs instead of 10 FMP calls) took the
> full run from ~29s to ~18s, and dropping Alpha Vantage sentiment (premium-only since
> ~2026-10-06) took markets from 19.1s to 13.0s (2026-10-13; full run 18.8s). Sports now gates.


Two sequential phases, each internally parallel:

```
Phase A — Ticker quotes + company news, 2 concurrent workers
  (max_workers=2 — one per Finnhub key, not per ticker):
  ~36 tickers / 2 workers, threads make no DB calls; quotes and news are
  batch-upserted once after the pool drains, not per-ticker.
  (ETFs/crypto/forex/commodity: quote only; stocks: quote + Finnhub news)

Phase B — market news + economic indicators, run in a SECOND
  ThreadPoolExecutor, concurrently — each hits a different API
  (Finnhub / FMP + FRED), so there's no contention:
    ├─ Market news (Finnhub), 4 categories
    └─ Economic indicators (FMP treasury rates + 6 macro indicators, then real GDP from FRED)

Wall time = Phase A + max(Phase B steps), not the sum of every step.
```

---

## Notes

- Markets' ticker-fetch phase is capped at 2 concurrent threads (one per Finnhub key, `max_workers=2`); markets' Phase B runs market news and econ side by side
