import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { EtlTriggerButton } from "@/components/etl-trigger";

type TableRow = { label: string; count: number | null };

type DomainStat = {
  domain: string;
  key: string;
  accent: string;
  rows: TableRow[];
  lastFetch: string | null;
};

/** Per-domain outcome as recorded by the orchestrator on the etl_runs row. */
type DomainOutcome = {
  state: "ok" | "skipped" | "failed";
  error: string | null;
  errors: string[];
  notes: string[];
  counters: TableRow[];
};

type EtlRun = {
  id: string;
  status: string;
  tier: string;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  errors: string[] | null;
  domains: Record<string, DomainOutcome>;
  cleanupTotal: number | null;
};

const STATUS_COLOR: Record<string, string> = {
  success: "hsl(142 65% 42%)",
  partial: "hsl(45 90% 52%)",
  failed: "hsl(0 72% 50%)",
  running: "hsl(220 90% 52%)",
};

const DOMAIN_ACCENT: Record<string, string> = {
  sports: "hsl(25 95% 50%)",
  markets: "hsl(142 65% 42%)",
  news: "hsl(220 90% 52%)",
  media: "hsl(340 78% 50%)",
};

/** Counters worth surfacing per domain, in display order. Anything else in the
 *  stats payload (errors, notes, ok, skipped) is handled separately. */
const COUNTER_LABELS: Record<string, string> = {
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

function parseDomains(stats: unknown): Record<string, DomainOutcome> {
  const out: Record<string, DomainOutcome> = {};
  if (!stats || typeof stats !== "object") return out;
  for (const [domain, raw] of Object.entries(stats as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const counters = Object.entries(COUNTER_LABELS)
      .filter(([k]) => typeof s[k] === "number")
      .map(([k, label]) => ({ label, count: s[k] as number }));
    const skipped = s.skipped === true;
    // Runs recorded before the orchestrator persisted an explicit `ok` flag
    // have to be inferred: no error and at least one row written. Falling back
    // to "no error field" alone would read a domain that wrote nothing — the
    // exact shape of a media failure — as a success.
    const ok =
      s.ok === undefined ? !s.error && counters.some((c) => (c.count ?? 0) > 0) : s.ok === true;
    out[domain] = {
      state: skipped ? "skipped" : ok ? "ok" : "failed",
      error: typeof s.error === "string" ? s.error : null,
      errors: Array.isArray(s.errors) ? (s.errors as string[]) : [],
      notes: Array.isArray(s.notes) ? (s.notes as string[]) : [],
      counters,
    };
  }
  return out;
}

/** Kept wider than the history list renders: per-domain freshness is derived
 *  from the newest run in which that domain actually succeeded, which can be
 *  further back than the last dozen runs on a day with manual retries. */
const RUN_LOOKBACK = 40;
const HISTORY_SHOWN = 12;

async function getRuns(): Promise<EtlRun[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("etl_runs")
    .select("id, status, tier, triggered_by, started_at, finished_at, duration_seconds, stats, errors, cleanup")
    .order("started_at", { ascending: false })
    .limit(RUN_LOOKBACK);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => {
    const cleanup = r.cleanup && typeof r.cleanup === "object" ? r.cleanup : null;
    const cleanupTotal = cleanup
      ? Object.entries(cleanup)
          .filter(([k, v]) => k !== "ran_at" && k !== "error" && typeof v === "number")
          .reduce((sum, [, v]) => sum + (v as number), 0)
      : null;
    return {
      id: r.id,
      status: r.status,
      tier: r.tier,
      triggered_by: r.triggered_by,
      started_at: r.started_at,
      finished_at: r.finished_at,
      duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
      errors: Array.isArray(r.errors) ? r.errors : [],
      domains: parseDomains(r.stats),
      cleanupTotal,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Newest run in which this domain reported success, or null if none did.
 *
 *  This replaces the old per-table timestamp lookups, which asked every table
 *  for `created_at` — a column none of them has. The reads errored silently and
 *  three of four domains showed "never" no matter how recent the sync was. Nor
 *  can `fetched_at` stand in: sports_news and sports_scores deliberately have
 *  no ingest timestamp (retention prunes them by published_at / game_date), so
 *  etl_runs is the only uniform answer for all four domains. */
function lastSuccess(runs: EtlRun[], domain: string): string | null {
  const hit = runs.find((r) => r.domains[domain]?.state === "ok");
  return hit ? hit.finished_at ?? hit.started_at : null;
}

async function getDomainStats(runs: EtlRun[]): Promise<DomainStat[]> {
  const supabase = await createClient();

  const [
    sportsNewsCount,
    sportsScoresCount,
    stocksCount,
    quotesCount,
    companyNewsCount,
    newsCount,
    youtubeCount,
  ] = await Promise.all([
    supabase.from("sports_news").select("*",      { count: "exact", head: true }),
    supabase.from("sports_scores").select("*",    { count: "exact", head: true }),

    supabase.from("stocks").select("*",           { count: "exact", head: true }).eq("is_active", true),
    supabase.from("stock_quotes").select("*",     { count: "exact", head: true }),
    supabase.from("company_news").select("*",     { count: "exact", head: true }),

    supabase.from("news_articles").select("*",    { count: "exact", head: true }),

    supabase.from("youtube_videos").select("*",   { count: "exact", head: true }),
  ]);

  return [
    {
      domain: "Sports",
      key: "sports",
      accent: DOMAIN_ACCENT.sports,
      rows: [
        { label: "News articles", count: sportsNewsCount.count },
        { label: "Score records", count: sportsScoresCount.count },
      ],
      lastFetch: lastSuccess(runs, "sports"),
    },
    {
      domain: "Markets",
      key: "markets",
      accent: DOMAIN_ACCENT.markets,
      rows: [
        { label: "Tracked stocks", count: stocksCount.count },
        { label: "Quote snapshots", count: quotesCount.count },
        { label: "Company news",   count: companyNewsCount.count },
      ],
      lastFetch: lastSuccess(runs, "markets"),
    },
    {
      domain: "News",
      key: "news",
      accent: DOMAIN_ACCENT.news,
      rows: [
        { label: "Articles", count: newsCount.count },
      ],
      lastFetch: lastSuccess(runs, "news"),
    },
    {
      domain: "Media",
      key: "media",
      accent: DOMAIN_ACCENT.media,
      rows: [
        { label: "YouTube videos", count: youtubeCount.count },
      ],
      lastFetch: lastSuccess(runs, "media"),
    },
  ];
}

function syncAge(isoDate: string | null): string {
  if (!isoDate) return "never";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

function clockTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "hsl(0 0% 50%)";
  return (
    <span
      className="text-[9px] font-mono tracking-widest uppercase font-bold px-1.5 py-0.5 border"
      style={{ color, borderColor: color }}
    >
      {status}
    </span>
  );
}

const STATE_LABEL: Record<DomainOutcome["state"], string> = {
  ok: "OK",
  skipped: "SKIP",
  failed: "FAIL",
};

const STATE_COLOR: Record<DomainOutcome["state"], string> = {
  ok: "hsl(142 65% 42%)",
  skipped: "hsl(45 90% 52%)",
  failed: "hsl(0 72% 50%)",
};

/** Panel chrome shared with the profile page's SectionCard. */
function Panel({
  title,
  accent,
  meta,
  children,
}: {
  title: string;
  accent: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border">
      <div
        className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2"
        style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
      >
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">{title}</span>
        {meta}
      </div>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  const admin = await isSuperAdmin();
  if (!admin) redirect("/");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const email = (claimsData?.claims?.email as string | undefined) ?? "";

  const runs = await getRuns();
  const stats = await getDomainStats(runs);

  const latest = runs[0] ?? null;
  const todayRuns = runs.filter(
    (r) => new Date(r.started_at).toDateString() === new Date().toDateString(),
  );
  const history = runs.slice(0, HISTORY_SHOWN);
  const domainOrder = ["sports", "markets", "news", "media"];

  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* ── Masthead — matches the profile page: title + identity left, the
             facts you'd otherwise give a card of their own inline right ── */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <div className="min-w-0">
            <h1
              className="text-xl font-black tracking-tight leading-none"
              style={{ fontFamily: "Georgia, serif" }}
            >
              ADMIN DASHBOARD
            </h1>
            <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{email}</p>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <div>
              <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase">
                Last run
              </p>
              <p className="text-[10px] font-mono mt-0.5">
                {latest ? syncAge(latest.finished_at ?? latest.started_at) : "never"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase">
                Runs today
              </p>
              <p className="text-[10px] font-mono mt-0.5 tabular-nums">{todayRuns.length}</p>
            </div>
            <div>
              <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase">
                Status
              </p>
              <div className="mt-0.5">
                {latest ? <StatusPill status={latest.status} /> : <span className="text-[10px] font-mono">—</span>}
              </div>
            </div>
            <Link
              href="/profile"
              className="shrink-0 text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors"
            >
              ← Profile
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          {/* ── Latest run, per domain: the outcome the orchestrator recorded,
                 its counters, and every error it collected ── */}
          <Panel
            title="Latest ETL Run"
            accent="hsl(45 90% 52%)"
            meta={
              latest ? (
                <span className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground tracking-wider">
                  <span className="uppercase">{latest.tier} · {latest.triggered_by}</span>
                  <span className="tabular-nums">
                    {clockTime(latest.started_at)}
                    {latest.duration_seconds != null && ` · ${latest.duration_seconds}s`}
                  </span>
                  <StatusPill status={latest.status} />
                </span>
              ) : null
            }
          >
            {!latest ? (
              <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">
                No ETL run has been recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {domainOrder.map((key) => {
                  const d = latest.domains[key];
                  if (!d) {
                    return (
                      <div
                        key={key}
                        className="px-3 py-1.5 flex items-center gap-2 border-l-[3px]"
                        style={{ borderLeftColor: "hsl(0 0% 50%)" }}
                      >
                        <span className="text-[10px] font-mono uppercase tracking-wider font-bold w-16 shrink-0">
                          {key}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          not part of this run
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={key}
                      className="px-3 py-1.5 border-l-[3px]"
                      style={{ borderLeftColor: DOMAIN_ACCENT[key] }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono uppercase tracking-wider font-bold w-16 shrink-0">
                          {key}
                        </span>
                        <span
                          className="text-[9px] font-mono tracking-widest font-bold shrink-0"
                          style={{ color: STATE_COLOR[d.state] }}
                        >
                          {STATE_LABEL[d.state]}
                        </span>
                        <span className="flex items-center gap-3 flex-wrap min-w-0">
                          {d.counters.map((c) => (
                            <span key={c.label} className="text-[10px] font-mono text-muted-foreground">
                              {c.label}{" "}
                              <span className="text-foreground font-bold tabular-nums">
                                {c.count?.toLocaleString() ?? "—"}
                              </span>
                            </span>
                          ))}
                        </span>
                      </div>

                      {d.error && (
                        <p className="mt-1 text-[10px] font-mono" style={{ color: "hsl(0 72% 50%)" }}>
                          ↳ {d.error}
                        </p>
                      )}
                      {d.notes.map((n) => (
                        <p key={n} className="mt-1 text-[10px] font-mono text-muted-foreground">
                          ↳ {n}
                        </p>
                      ))}
                      {d.errors.slice(0, 4).map((e) => (
                        <p
                          key={e}
                          className="mt-1 text-[10px] font-mono break-words"
                          style={{ color: "hsl(45 90% 45%)" }}
                        >
                          ↳ {e}
                        </p>
                      ))}
                      {d.errors.length > 4 && (
                        <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                          ↳ … and {d.errors.length - 4} more
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="px-3 py-1.5 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase">
                    {latest.errors?.length
                      ? `${latest.errors.length} error${latest.errors.length === 1 ? "" : "s"} recorded`
                      : "No errors recorded"}
                  </span>
                  {latest.cleanupTotal != null && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      Retention pruned{" "}
                      <span className="text-foreground font-bold tabular-nums">
                        {latest.cleanupTotal.toLocaleString()}
                      </span>{" "}
                      rows
                    </span>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* ── Stored data: row counts and true freshness per domain ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {stats.map((s) => (
              <Panel
                key={s.domain}
                title={s.domain}
                accent={s.accent}
                meta={
                  <span className="text-[9px] font-mono text-muted-foreground tracking-wider">
                    {syncAge(s.lastFetch)}
                  </span>
                }
              >
                <div className="px-3 py-2 flex flex-col gap-1.5">
                  {s.rows.map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-4">
                      <span className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase truncate">
                        {r.label}
                      </span>
                      <span className="text-sm font-black tabular-nums shrink-0">
                        {r.count?.toLocaleString() ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>

          <Panel title="Manual Refresh" accent="hsl(45 90% 52%)">
            <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] font-mono text-muted-foreground">
                Sports · News · Market quotes — skips sentiment, media, and economic indicators
              </span>
              <EtlTriggerButton />
            </div>
          </Panel>
        </div>

        {/* ── Run history rail ── */}
        <Panel
          title="Run History"
          accent="hsl(220 90% 52%)"
          meta={
            <span className="text-[9px] font-mono text-muted-foreground tracking-wider">
              last {history.length}
            </span>
          }
        >
          {history.length === 0 ? (
            <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">No runs recorded.</p>
          ) : (
            <div className="divide-y divide-border">
              {history.map((r) => (
                <div
                  key={r.id}
                  className="px-3 py-1.5 flex items-center gap-2 border-l-[3px]"
                  style={{ borderLeftColor: STATUS_COLOR[r.status] ?? "hsl(0 0% 50%)" }}
                >
                  <span className="text-[10px] font-mono tabular-nums shrink-0">
                    {clockTime(r.started_at)}
                  </span>
                  <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
                    {r.tier}
                  </span>
                  <span
                    className="text-[9px] font-mono uppercase tracking-wider font-bold shrink-0"
                    style={{ color: STATUS_COLOR[r.status] ?? undefined }}
                  >
                    {r.status}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums ml-auto shrink-0">
                    {r.duration_seconds != null ? `${r.duration_seconds}s` : "—"}
                  </span>
                  {!!r.errors?.length && (
                    <span
                      className="text-[9px] font-mono tabular-nums shrink-0"
                      style={{ color: "hsl(45 90% 45%)" }}
                      title={`${r.errors.length} errors`}
                    >
                      {r.errors.length}⚠
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
