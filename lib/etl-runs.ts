/** Shapes and presentation constants for `info_agg.etl_runs` rows.
 *
 *  Kept free of server-only imports so the dashboard page (server) and the
 *  expandable history list (client) can share one definition of a run and one
 *  set of colors, instead of drifting apart. */

export type CounterRow = { label: string; count: number | null };

/** Per-domain outcome as recorded by the orchestrator on the etl_runs row. */
export type DomainOutcome = {
  state: "ok" | "degraded" | "skipped" | "failed";
  error: string | null;
  errors: string[];
  notes: string[];
  counters: CounterRow[];
};

export type EtlRun = {
  id: string;
  status: string;
  tier: string;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  errors: string[];
  domains: Record<string, DomainOutcome>;
  cleanupTotal: number | null;
};

export const DOMAIN_ORDER = ["sports", "markets", "news", "media"] as const;

export const STATUS_COLOR: Record<string, string> = {
  success: "hsl(142 65% 42%)",
  partial: "hsl(45 90% 52%)",
  failed: "hsl(0 72% 50%)",
  running: "hsl(220 90% 52%)",
};

export const DOMAIN_ACCENT: Record<string, string> = {
  sports: "hsl(25 95% 50%)",
  markets: "hsl(142 65% 42%)",
  news: "hsl(220 90% 52%)",
  media: "hsl(340 78% 50%)",
};

export const STATE_LABEL: Record<DomainOutcome["state"], string> = {
  ok: "OK",
  degraded: "WARN",
  skipped: "SKIP",
  failed: "FAIL",
};

export const STATE_COLOR: Record<DomainOutcome["state"], string> = {
  ok: "hsl(142 65% 42%)",
  degraded: "hsl(30 90% 50%)",
  skipped: "hsl(45 90% 52%)",
  failed: "hsl(0 72% 50%)",
};

/** Counters worth surfacing per domain, in display order. Anything else in the
 *  stats payload (errors, notes, ok, skipped, degraded) is handled separately. */
export const COUNTER_LABELS: Record<string, string> = {
  leagues_processed: "Leagues",
  news_inserted: "News",
  scores_inserted: "Scores",
  season_scores: "Season scores",
  standings_rows: "Standings",
  stocks_processed: "Tickers",
  quotes_inserted: "Quotes",
  market_news_inserted: "Market news",
  sentiment_upserted: "Sentiment",
  economic_rows_upserted: "Econ rows",
  sections_processed: "Sections",
  articles_inserted: "Articles",
  youtube_videos: "Videos",
};

export function parseDomains(stats: unknown): Record<string, DomainOutcome> {
  const out: Record<string, DomainOutcome> = {};
  if (!stats || typeof stats !== "object") return out;
  for (const [domain, raw] of Object.entries(stats as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const counters = Object.entries(COUNTER_LABELS)
      .filter(([k]) => typeof s[k] === "number")
      .map(([k, label]) => ({ label, count: s[k] as number }));
    const skipped = s.skipped === true;
    // Wrote nothing but did not take the run down with it (media). Distinct
    // from ok, or the dashboard would show a dead source in green.
    const degraded = s.degraded === true;
    // Runs recorded before the orchestrator persisted an explicit `ok` flag
    // have to be inferred: no error and at least one row written. Falling back
    // to "no error field" alone would read a domain that wrote nothing — the
    // exact shape of a media failure — as a success.
    const ok =
      s.ok === undefined ? !s.error && counters.some((c) => (c.count ?? 0) > 0) : s.ok === true;
    out[domain] = {
      state: skipped ? "skipped" : degraded ? "degraded" : ok ? "ok" : "failed",
      error: typeof s.error === "string" ? s.error : null,
      errors: Array.isArray(s.errors) ? (s.errors as string[]) : [],
      notes: Array.isArray(s.notes) ? (s.notes as string[]) : [],
      counters,
    };
  }
  return out;
}

/**
 * Human label for a run's tier.
 *
 * `daily` is the full nightly run; `a` / `b` are the intraday tiers (A carries
 * no news, so a missing domain there is by design); `scoped:news+media` is an
 * operator run launched with --news-only and friends. The scoped domains are
 * already visible as rows in the breakdown, so the chip only needs to say the
 * run was scoped rather than repeat them.
 */
export function tierLabel(tier: string): string {
  if (tier.startsWith("scoped:")) return "scoped";
  if (tier === "a" || tier === "b") return `intraday ${tier.toUpperCase()}`;
  return tier;
}

/** Total rows pruned by the run's `cleanup_daily()` report, if it ran. */
export function cleanupTotal(cleanup: unknown): number | null {
  if (!cleanup || typeof cleanup !== "object") return null;
  return Object.entries(cleanup as Record<string, unknown>)
    .filter(([k, v]) => k !== "ran_at" && k !== "error" && typeof v === "number")
    .reduce((sum, [, v]) => sum + (v as number), 0);
}
