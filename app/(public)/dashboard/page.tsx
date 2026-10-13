import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { EtlTriggerButton } from "@/components/etl-trigger";
import { EtlRunBreakdown } from "@/components/etl-run-breakdown";
import { EtlRunHistory } from "@/components/etl-run-history";
import { formatAge, formatTime, isTodayEastern } from "@/lib/format-date";
import {
  cleanupTotal,
  parseDomains,
  DOMAIN_ACCENT,
  STATUS_COLOR,
  tierLabel,
  type CounterRow,
  type EtlRun,
} from "@/lib/etl-runs";

type DomainStat = {
  domain: string;
  key: string;
  accent: string;
  rows: CounterRow[];
  lastFetch: string | null;
};

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
  return (data ?? []).map((r: any) => ({
    id: r.id,
    status: r.status,
    tier: r.tier,
    triggered_by: r.triggered_by,
    started_at: r.started_at,
    finished_at: r.finished_at,
    duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    errors: Array.isArray(r.errors) ? r.errors : [],
    domains: parseDomains(r.stats),
    cleanupTotal: cleanupTotal(r.cleanup),
  }));
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
  // "Today" is the Eastern calendar day — toDateString() used the server's zone,
  // so on UTC hosting the count rolled over at 8pm ET.
  const todayRuns = runs.filter((r) => isTodayEastern(r.started_at));
  const history = runs.slice(0, HISTORY_SHOWN);

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
                {formatAge(latest?.finished_at ?? latest?.started_at ?? null)}
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
              href="/dashboard/activity"
              className="shrink-0 text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors"
            >
              Site activity →
            </Link>
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
                  <span className="uppercase">{tierLabel(latest.tier)} · {latest.triggered_by}</span>
                  <span className="tabular-nums">
                    {formatTime(latest.started_at, true)}
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
              <EtlRunBreakdown run={latest} />
            )}
          </Panel>

          {/* ── Stored data: row counts and per-domain freshness ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {stats.map((s) => (
              <Panel
                key={s.domain}
                title={s.domain}
                accent={s.accent}
                meta={
                  <span className="text-[9px] font-mono text-muted-foreground tracking-wider">
                    {formatAge(s.lastFetch)}
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
                Sports · News · Market quotes — skips media and economic indicators
              </span>
              <EtlTriggerButton />
            </div>
          </Panel>
        </div>

        {/* ── Run history rail — each row expands into its own breakdown ── */}
        <Panel
          title="Run History"
          accent="hsl(220 90% 52%)"
          meta={
            <span className="text-[9px] font-mono text-muted-foreground tracking-wider">
              last {history.length} · click to expand
            </span>
          }
        >
          <EtlRunHistory runs={history} />
        </Panel>
      </div>
    </div>
  );
}
