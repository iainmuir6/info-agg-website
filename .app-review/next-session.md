# Next session — open from 2026-10-08

Branch `main`. Delete each line as it's resolved; delete the file when empty.

- [ ] **Morning briefing push on a real device** (shipped 2026-10-08, 948b3ae) —
      nothing delivered yet: no device is subscribed. On the home-screen app:
      Profile → Notifications → Turn On, then expect the next briefing ~7:00 ET.
      Delivery runs through cmf-tracker's notify platform; if nothing arrives,
      query `notify.events where app = 'info_agg'` (see cmf-tracker
      docs/notifications.md).
- [ ] **No `.app-stack/runs.md`** — this repo has earlier app-stack history;
      the run-log backfill was offered, not done.
