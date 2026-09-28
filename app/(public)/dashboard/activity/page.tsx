import Link from "next/link";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/rbac";
import { ActivityChart } from "@/components/activity-chart";
import {
  DIMENSIONS,
  RANGES,
  getActivityReport,
  isDimension,
  isRangeKey,
  type ActivityReport,
  type BreakdownRow,
  type Dimension,
  type Filter,
  type RangeKey,
  type Totals,
} from "@/lib/web-analytics";

type SearchParams = Promise<{ range?: string; f?: string | string[] }>;

/** Breakdown panels, in reading order. Environment is a filter target but not
 *  worth a panel of its own — it is "production" for every real visit. */
const PANELS: { dim: Dimension; accent: string }[] = [
  { dim: "requestPath", accent: "hsl(220 90% 56%)" },
  { dim: "route", accent: "hsl(220 90% 56%)" },
  { dim: "referrerHostname", accent: "hsl(280 70% 58%)" },
  { dim: "country", accent: "hsl(142 65% 42%)" },
  { dim: "deviceType", accent: "hsl(45 90% 52%)" },
  { dim: "browserName", accent: "hsl(45 90% 52%)" },
  { dim: "osName", accent: "hsl(45 90% 52%)" },
  { dim: "utmSource", accent: "hsl(280 70% 58%)" },
];

const ROWS_SHOWN = 8;
const TZ = "America/New_York";

/** `?f=dim:value`, repeatable. Unknown dimensions are dropped here, which is
 *  what keeps the OData filter to the allow-list in lib/web-analytics.ts. One
 *  filter per dimension: a second value for the same one replaces the first,
 *  since `a eq x and a eq y` can only ever match nothing. */
function parseFilters(raw: string | string[] | undefined): Filter[] {
  const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const byDim = new Map<Dimension, string>();
  for (const item of list) {
    const i = item.indexOf(":");
    if (i <= 0) continue;
    const dim = item.slice(0, i);
    const value = item.slice(i + 1);
    if (isDimension(dim) && value) byDim.set(dim, value);
  }
  return [...byDim].map(([dim, value]) => ({ dim, value }));
}

function hrefFor(range: RangeKey, filters: Filter[]): string {
  const qs = new URLSearchParams();
  if (range !== "7d") qs.set("range", range);
  for (const f of filters) qs.append("f", `${f.dim}:${f.value}`);
  const s = qs.toString();
  return `/dashboard/activity${s ? `?${s}` : ""}`;
}

function withFilter(filters: Filter[], add: Filter): Filter[] {
  return [...filters.filter((f) => f.dim !== add.dim), add];
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function displayValue(dim: Dimension, value: string): string {
  if (dim === "country" && /^[A-Z]{2}$/.test(value)) {
    let name = value;
    try {
      name = regionNames.of(value) ?? value;
    } catch {}
    return `${flag(value)} ${name}`;
  }
  return value;
}

function bucketLabel(iso: string, bucket: "hour" | "day"): string {
  const d = new Date(iso);
  return bucket === "hour"
    ? d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric" })
    : d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", weekday: "short" });
}

function delta(now: number, before: number): { text: string; color: string } | null {
  if (before === 0) return now === 0 ? null : { text: "new", color: "hsl(142 65% 42%)" };
  const pct = ((now - before) / before) * 100;
  const rounded = Math.abs(pct) < 10 ? pct.toFixed(1) : Math.round(pct).toString();
  if (Math.abs(pct) < 0.05) return { text: "±0%", color: "hsl(0 0% 50%)" };
  return pct > 0
    ? { text: `▲ ${rounded}%`, color: "hsl(142 65% 42%)" }
    : { text: `▼ ${rounded.replace("-", "")}%`, color: "hsl(0 72% 51%)" };
}

/** Panel chrome shared with /dashboard and the profile page's SectionCard. */
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
    <div className="border border-border min-w-0">
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

function Kpi({ label, value, previous, hint }: { label: string; value: string; previous?: [number, number]; hint?: string }) {
  const d = previous ? delta(previous[0], previous[1]) : null;
  return (
    <div className="border border-border px-3 py-2 min-w-0">
      <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase">{label}</p>
      <p className="text-2xl font-black tabular-nums leading-tight mt-0.5">{value}</p>
      <p className="text-[9px] font-mono mt-0.5 tabular-nums truncate">
        {d ? <span style={{ color: d.color }}>{d.text}</span> : <span className="text-muted-foreground">—</span>}
        <span className="text-muted-foreground"> {hint ?? "vs previous period"}</span>
      </p>
    </div>
  );
}

function BreakdownRows({
  dim,
  rows,
  total,
  range,
  filters,
  accent,
}: {
  dim: Dimension;
  rows: BreakdownRow[];
  total: number;
  range: RangeKey;
  filters: Filter[];
  accent: string;
}) {
  const active = filters.find((f) => f.dim === dim)?.value;
  const max = Math.max(1, ...rows.map((r) => r.pageviews));

  const row = (r: BreakdownRow) => {
    // "Others" is the API's roll-up of everything past the limit — not a real
    // value, so it isn't something you can filter on.
    const filterable = r.key !== "(none)" && r.key !== "Others";
    const isActive = active === r.key;
    const inner = (
      <>
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 opacity-15"
          style={{ width: `${(r.pageviews / max) * 100}%`, background: accent }}
        />
        <span className="relative truncate text-[11px] font-mono" title={r.key}>
          {displayValue(dim, r.key)}
        </span>
        <span className="relative shrink-0 flex items-baseline gap-2 tabular-nums">
          <span className="text-[9px] font-mono text-muted-foreground w-9 text-right">
            {total > 0 ? `${((r.pageviews / total) * 100).toFixed(r.pageviews / total < 0.1 ? 1 : 0)}%` : ""}
          </span>
          <span className="text-[9px] font-mono text-muted-foreground w-10 text-right" title="Visitors">
            {r.visitors.toLocaleString()}
          </span>
          <span className="text-[11px] font-mono font-bold w-12 text-right" title="Page views">
            {r.pageviews.toLocaleString()}
          </span>
        </span>
      </>
    );
    const cls = `relative flex items-center justify-between gap-3 px-3 py-1 ${
      isActive ? "outline outline-1 -outline-offset-1 outline-foreground" : ""
    }`;
    return filterable ? (
      <Link
        key={r.key}
        href={hrefFor(range, isActive ? filters.filter((f) => f.dim !== dim) : withFilter(filters, { dim, value: r.key }))}
        className={`${cls} hover:bg-secondary transition-colors`}
        title={isActive ? "Remove filter" : `Filter to ${r.key}`}
        scroll={false}
      >
        {inner}
      </Link>
    ) : (
      <div key={r.key} className={cls}>
        {inner}
      </div>
    );
  };

  if (rows.length === 0) {
    return <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">No data for this range.</p>;
  }

  const head = rows.slice(0, ROWS_SHOWN);
  const rest = rows.slice(ROWS_SHOWN);
  return (
    <div className="py-1">
      <div className="px-3 pb-1 flex justify-end gap-2 text-[8px] font-mono tracking-widest uppercase text-muted-foreground">
        <span className="w-9 text-right">Share</span>
        <span className="w-10 text-right">Visitors</span>
        <span className="w-12 text-right">Views</span>
      </div>
      {head.map(row)}
      {rest.length > 0 && (
        <details className="group">
          <summary className="list-none cursor-pointer px-3 py-1 text-[9px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground">
            <span className="group-open:hidden">+ {rest.length} more</span>
            <span className="hidden group-open:inline">− show less</span>
          </summary>
          {rest.map(row)}
        </details>
      )}
    </div>
  );
}

function SetupNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel title={title} accent="hsl(0 72% 51%)">
      <div className="px-3 py-3 space-y-2 text-[11px] font-mono text-muted-foreground leading-relaxed">{children}</div>
    </Panel>
  );
}

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await isSuperAdmin();
  if (!admin) redirect("/");

  const sp = await searchParams;
  const range: RangeKey = isRangeKey(sp.range) ? sp.range : "7d";
  const filters = parseFilters(sp.f);
  const result = await getActivityReport(range, filters);

  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* ── Masthead: title + range picker ── */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight leading-none" style={{ fontFamily: "Georgia, serif" }}>
              SITE ACTIVITY
            </h1>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Vercel Web Analytics · production · times in ET
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <nav className="flex border border-border" aria-label="Date range">
              {(Object.keys(RANGES) as RangeKey[]).map((r) => (
                <Link
                  key={r}
                  href={hrefFor(r, filters)}
                  scroll={false}
                  aria-current={r === range ? "page" : undefined}
                  className={`text-[10px] font-mono tracking-widest uppercase px-2.5 py-1.5 transition-colors ${
                    r === range ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r}
                </Link>
              ))}
            </nav>
            <Link
              href="/dashboard"
              className="shrink-0 text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* ── Active filters ── */}
      {filters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground">Filtered to</span>
          {filters.map((f) => (
            <Link
              key={f.dim}
              href={hrefFor(range, filters.filter((x) => x.dim !== f.dim))}
              scroll={false}
              className="text-[10px] font-mono border border-foreground px-2 py-0.5 hover:bg-secondary transition-colors"
              title="Remove filter"
            >
              <span className="text-muted-foreground uppercase tracking-wider">{DIMENSIONS[f.dim]}:</span>{" "}
              {displayValue(f.dim, f.value)} ✕
            </Link>
          ))}
          <Link
            href={hrefFor(range, [])}
            scroll={false}
            className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground"
          >
            Clear all
          </Link>
        </div>
      )}

      {!result.ok ? (
        result.error.kind === "no-token" ? (
          <SetupNotice title="Not configured">
            <p>
              <span className="text-foreground">VERCEL_ANALYTICS_TOKEN</span> is not set. Create a token at
              vercel.com/account/tokens scoped to the team that owns this project, then add it to the Vercel
              project&apos;s environment variables (and <span className="text-foreground">.env.local</span> for dev).
            </p>
          </SetupNotice>
        ) : (
          <SetupNotice title={`Analytics API error${result.error.status ? ` · ${result.error.status}` : ""}`}>
            <p className="text-foreground break-words">{result.error.detail}</p>
            <p>
              A 403 usually means the token is scoped to a different team than the project. A 404 or empty
              response usually means Web Analytics is not enabled on the project yet (Vercel → Analytics → Enable).
            </p>
          </SetupNotice>
        )
      ) : (
        <Report report={result.report} range={range} filters={filters} />
      )}
    </div>
  );
}

function Report({
  report,
  range,
  filters,
}: {
  report: ActivityReport;
  range: RangeKey;
  filters: Filter[];
}) {
  const { totals, previous, series, breakdowns, bucket } = report;
  const perVisitor = (t: Totals) => (t.visitors > 0 ? t.pageviews / t.visitors : 0);
  const topPage = breakdowns.requestPath[0];
  const topReferrer = breakdowns.referrerHostname.find((r) => r.key !== "(none)" && r.key !== "Others");
  const mobile = breakdowns.deviceType.find((r) => r.key.toLowerCase() === "mobile")?.pageviews ?? 0;

  const points = series.map((p) => ({
    label: bucketLabel(p.timestamp, bucket),
    pageviews: p.pageviews,
    visitors: p.visitors,
  }));

  return (
    <>
      {/* ── KPIs, each against the same-length window just before ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Page views" value={totals.pageviews.toLocaleString()} previous={[totals.pageviews, previous.pageviews]} />
        <Kpi label="Visitors" value={totals.visitors.toLocaleString()} previous={[totals.visitors, previous.visitors]} />
        <Kpi
          label="Views / visitor"
          value={perVisitor(totals).toFixed(2)}
          previous={[perVisitor(totals), perVisitor(previous)]}
        />
        <Kpi
          label="Mobile share"
          value={totals.pageviews > 0 ? `${Math.round((mobile / totals.pageviews) * 100)}%` : "—"}
          hint="of page views"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 min-w-0">
          <Panel
            title="Traffic"
            accent="hsl(220 90% 56%)"
            meta={
              <span className="text-[9px] font-mono text-muted-foreground tracking-wider">
                last {RANGES[range].label} · by {bucket}
              </span>
            }
          >
            <ActivityChart points={points} />
          </Panel>
        </div>
        <Panel title="At a glance" accent="hsl(45 90% 52%)">
          <dl className="px-3 py-2 space-y-2">
            {[
              ["Top page", topPage ? `${topPage.key} · ${topPage.pageviews.toLocaleString()}` : "—"],
              ["Top referrer", topReferrer ? `${topReferrer.key} · ${topReferrer.pageviews.toLocaleString()}` : "Direct only"],
              ["Countries", breakdowns.country.filter((r) => r.key !== "Others").length.toLocaleString()],
              ["Previous period", `${previous.pageviews.toLocaleString()} views · ${previous.visitors.toLocaleString()} visitors`],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[8px] font-mono tracking-widest uppercase text-muted-foreground">{k}</dt>
                <dd className="text-[11px] font-mono truncate" title={v}>{v}</dd>
              </div>
            ))}
            <p className="pt-1 text-[9px] font-mono text-muted-foreground leading-relaxed">
              Click any row below to filter the whole page to it; click it again to remove. Visitors are
              anonymous — Vercel Analytics sets no cookies and records no user id.
            </p>
          </dl>
        </Panel>
      </div>

      {/* ── Breakdowns: every row is a filter link ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
        {PANELS.map(({ dim, accent }) => (
          <Panel
            key={dim}
            title={DIMENSIONS[dim]}
            accent={accent}
            meta={
              <span className="text-[9px] font-mono text-muted-foreground tracking-wider tabular-nums">
                {breakdowns[dim].length} values
              </span>
            }
          >
            <BreakdownRows
              dim={dim}
              rows={breakdowns[dim]}
              total={totals.pageviews}
              range={range}
              filters={filters}
              accent={accent}
            />
          </Panel>
        ))}
      </div>
    </>
  );
}
