import "server-only";

// Server-side reader for Vercel Web Analytics — the data `<Analytics />` in the
// root layout collects. Backs /dashboard/activity.
//
// Requires VERCEL_ANALYTICS_TOKEN: a Vercel access token (vercel.com/account/
// tokens) scoped to the team that owns the project. The project/team ids
// default to this repo's project, mirroring GITHUB_REPOSITORY's default in
// lib/github-dispatch.ts; override them only if the project moves.
//
// Vercel Web Analytics is cookieless and anonymous by design — there is no
// user id to break down by, so "who" is only ever country/device/browser.

const API = "https://api.vercel.com/v1/query/web-analytics";
const PROJECT_ID = process.env.VERCEL_ANALYTICS_PROJECT_ID ?? "prj_Et5fOLNjZfSe3vFve46dslby2lzR";
const TEAM_ID = process.env.VERCEL_ANALYTICS_TEAM_ID ?? "team_kVLAJ1y4YhEufyMqnINuL1P1";

/** Numbers change slowly enough that five minutes of staleness is invisible,
 *  and every filter click is a fresh page render — without this each click
 *  would cost a dozen API calls. */
const REVALIDATE_SECONDS = 300;

export const RANGES = {
  "24h": { label: "24 hours", ms: 24 * 3600_000, bucket: "hour" },
  "7d": { label: "7 days", ms: 7 * 86_400_000, bucket: "day" },
  "30d": { label: "30 days", ms: 30 * 86_400_000, bucket: "day" },
  "90d": { label: "90 days", ms: 90 * 86_400_000, bucket: "day" },
} as const;

export type RangeKey = keyof typeof RANGES;

export function isRangeKey(v: string | undefined): v is RangeKey {
  return v != null && v in RANGES;
}

/** Dimensions the page breaks down by, and the only ones it will accept as
 *  filters from the URL — this list is what keeps a crafted `?f=` from
 *  reaching the OData filter as anything but a quoted literal. */
export const DIMENSIONS = {
  requestPath: "Page",
  route: "Route",
  referrerHostname: "Referrer",
  country: "Country",
  deviceType: "Device",
  browserName: "Browser",
  osName: "OS",
  utmSource: "UTM source",
  environment: "Environment",
} as const;

export type Dimension = keyof typeof DIMENSIONS;

export function isDimension(v: string): v is Dimension {
  return v in DIMENSIONS;
}

export type Filter = { dim: Dimension; value: string };

export type Totals = { pageviews: number; visitors: number };
export type SeriesPoint = Totals & { timestamp: string };
export type BreakdownRow = Totals & { key: string };

export type AnalyticsError =
  | { kind: "no-token" }
  | { kind: "api"; status: number; detail: string };

class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Vercel analytics ${status}: ${detail}`);
  }
}

/** OData string literal: single quotes are escaped by doubling. */
function literal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Filters always pin an environment — the API defaults to production on its
 *  own, but saying so explicitly means an `environment` filter from the URL
 *  replaces the default instead of being ANDed with a contradiction. */
export function buildFilter(filters: Filter[]): string {
  const clauses = filters.map((f) => `${f.dim} eq ${literal(f.value)}`);
  if (!filters.some((f) => f.dim === "environment")) {
    clauses.unshift(`environment eq 'production'`);
  }
  return clauses.join(" and ");
}

async function query(
  path: "visits/count" | "visits/aggregate",
  params: Record<string, string | string[]>,
  token: string
): Promise<unknown> {
  const qs = new URLSearchParams({ projectId: PROJECT_ID, teamId: TEAM_ID });
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
  }
  const res = await fetch(`${API}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body)?.error?.message ?? detail;
    } catch {}
    throw new ApiError(res.status, detail || res.statusText);
  }
  return res.json();
}

// The response schema names only `timestamp` for time buckets; the metric
// field names are read defensively because the docs show both `pageviews`
// (count endpoint) and `count` (aggregate endpoint) for the same measure.
/* eslint-disable @typescript-eslint/no-explicit-any */
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function totalsOf(row: any): Totals {
  return {
    pageviews: num(row?.pageviews ?? row?.count ?? row?.total),
    visitors: num(row?.visitors ?? row?.devices),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function count(since: Date, until: Date, filter: string, token: string): Promise<Totals> {
  const body = (await query(
    "visits/count",
    { since: since.toISOString(), until: until.toISOString(), filter },
    token
  )) as { data?: unknown };
  return totalsOf(body.data);
}

async function series(
  since: Date,
  until: Date,
  bucket: string,
  filter: string,
  token: string
): Promise<SeriesPoint[]> {
  const body = (await query(
    "visits/aggregate",
    { since: since.toISOString(), until: until.toISOString(), by: bucket, filter, limit: "100" },
    token
  )) as { data?: unknown[] };
  return (body.data ?? [])
    .map((row) => ({ timestamp: String((row as { timestamp?: unknown }).timestamp ?? ""), ...totalsOf(row) }))
    .filter((p) => p.timestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function breakdown(
  dim: Dimension,
  since: Date,
  until: Date,
  filter: string,
  token: string
): Promise<BreakdownRow[]> {
  const body = (await query(
    "visits/aggregate",
    { since: since.toISOString(), until: until.toISOString(), by: dim, filter, limit: "25" },
    token
  )) as { data?: Record<string, unknown>[] };
  return (body.data ?? [])
    .map((row) => ({ key: row[dim] == null || row[dim] === "" ? "(none)" : String(row[dim]), ...totalsOf(row) }))
    .sort((a, b) => b.pageviews - a.pageviews);
}

/** Zero-fill the gaps: the API omits empty buckets, and a line drawn straight
 *  across a quiet night reads as traffic that never happened. */
function fillSeries(points: SeriesPoint[], since: Date, until: Date, bucket: "hour" | "day"): SeriesPoint[] {
  const step = bucket === "hour" ? 3600_000 : 86_400_000;
  const keyOf = (t: number) => {
    const d = new Date(t);
    if (bucket === "hour") d.setUTCMinutes(0, 0, 0);
    else d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  };
  const byKey = new Map<number, SeriesPoint>();
  for (const p of points) {
    const t = Date.parse(p.timestamp);
    if (Number.isFinite(t)) byKey.set(keyOf(t), p);
  }
  const out: SeriesPoint[] = [];
  for (let t = keyOf(since.getTime()); t <= until.getTime(); t += step) {
    out.push(byKey.get(t) ?? { timestamp: new Date(t).toISOString(), pageviews: 0, visitors: 0 });
  }
  return out;
}

export type ActivityReport = {
  range: RangeKey;
  since: string;
  until: string;
  bucket: "hour" | "day";
  totals: Totals;
  previous: Totals;
  series: SeriesPoint[];
  breakdowns: Record<Dimension, BreakdownRow[]>;
};

export async function getActivityReport(
  range: RangeKey,
  filters: Filter[]
): Promise<{ ok: true; report: ActivityReport } | { ok: false; error: AnalyticsError }> {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  if (!token) return { ok: false, error: { kind: "no-token" } };

  const { ms, bucket } = RANGES[range];
  // Rounded down to the minute so renders within the same minute share a
  // cache key instead of every request missing on a new millisecond.
  const until = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const since = new Date(until.getTime() - ms);
  const prevSince = new Date(since.getTime() - ms);
  const filter = buildFilter(filters);
  const dims = Object.keys(DIMENSIONS) as Dimension[];

  try {
    const [totals, previous, rawSeries, ...lists] = await Promise.all([
      count(since, until, filter, token),
      count(prevSince, since, filter, token),
      series(since, until, bucket, filter, token),
      ...dims.map((d) => breakdown(d, since, until, filter, token)),
    ]);
    return {
      ok: true,
      report: {
        range,
        since: since.toISOString(),
        until: until.toISOString(),
        bucket,
        totals,
        previous,
        series: fillSeries(rawSeries, since, until, bucket),
        breakdowns: Object.fromEntries(dims.map((d, i) => [d, lists[i]])) as Record<Dimension, BreakdownRow[]>,
      },
    };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: { kind: "api", status: e.status, detail: e.detail } };
    return { ok: false, error: { kind: "api", status: 0, detail: e instanceof Error ? e.message : String(e) } };
  }
}
