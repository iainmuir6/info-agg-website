/** Pure parsers for the two AI briefing payloads (misc_content kind='summary').
 *
 *  Split out of lib/ai-summary.ts (which is server-only and talks to Supabase)
 *  so the shape rules can be unit-tested and imported by client components.
 *  This is the only place that knows the payload shape; anything that does not
 *  fit is dropped rather than rendered, so a model that ignores its schema
 *  cannot reach the page.
 *
 *  Citations: each item and bullet carries `cites` (numbers into the payload's
 *  `sources`), written by _resolve_citations in
 *  src/api/summary/summary_db_helper.py. Payloads stored before citations
 *  existed have neither, and parse to empty `cites` and `sources`. */

/** The domain slugs the ETL constrains the model to (see DOMAINS in
 *  src/api/summary/summary_db_helper.py). */
export const SUMMARY_DOMAINS = {
  us_news: { label: "US", accent: "hsl(220 90% 52%)" },
  world_news: { label: "World", accent: "hsl(265 70% 55%)" },
  sports: { label: "Sports", accent: "hsl(25 95% 50%)" },
  markets: { label: "MKTS", accent: "hsl(142 65% 42%)" },
  media: { label: "Media", accent: "hsl(340 78% 50%)" },
} as const;

export type SummaryDomain = keyof typeof SUMMARY_DOMAINS;

export type SummarySourceKind = "article" | "market" | "quote" | "game";

export type SummarySource = {
  n: number;
  title: string;
  url: string;
  kind: SummarySourceKind;
  outlet: string | null;
};

export type SummaryItem = {
  domain: SummaryDomain;
  title: string;
  detail: string;
  cites: number[];
};

export type SummaryBullet = {
  text: string;
  cites: number[];
};

export type SummarySection = {
  domain: SummaryDomain;
  bullets: SummaryBullet[];
};

export type DaySummary = {
  headline: string | null;
  yesterday: SummaryItem[];
  today: SummaryItem[];
  sources: SummarySource[];
  model: string | null;
  generatedAt: string | null;
};

export type WeekSummary = {
  headline: string | null;
  sections: SummarySection[];
  sources: SummarySource[];
  model: string | null;
  generatedAt: string | null;
};

export type AiSummaries = {
  day: DaySummary | null;
  week: WeekSummary | null;
};

const SOURCE_KINDS: readonly SummarySourceKind[] = ["article", "market", "quote", "game"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isDomain = (v: unknown): v is SummaryDomain =>
  typeof v === "string" && Object.hasOwn(SUMMARY_DOMAINS, v);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v : null;

/** An http(s) URL, or a same-site path ("/markets/NVDA" but not "//host").
 *  Anything else (javascript:, data:, protocol-relative) is refused. */
export function isSafeSourceUrl(url: string): boolean {
  if (url.startsWith("/")) return !url.startsWith("//") && !url.startsWith("/\\");
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function isInternalSourceUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

/** The stored source list: valid entries only, unique by number, sorted. */
export function asSources(v: unknown): SummarySource[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<number>();
  const out: SummarySource[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const n = raw.n;
    const title = str(raw.title);
    const url = str(raw.url);
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || seen.has(n)) continue;
    if (!title || !url || !isSafeSourceUrl(url)) continue;
    const kind = SOURCE_KINDS.includes(raw.kind as SummarySourceKind)
      ? (raw.kind as SummarySourceKind)
      : "article";
    seen.add(n);
    out.push({ n, title, url, kind, outlet: str(raw.outlet) });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Cite numbers that point at a source we kept, in order, without repeats. */
function asCites(v: unknown, known: Set<number>): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const n of v) {
    if (typeof n === "number" && known.has(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export function asItems(v: unknown, known: Set<number> = new Set()): SummaryItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const title = str(raw.title);
    const detail = str(raw.detail);
    if (!isDomain(raw.domain) || !title || !detail) return [];
    return [{ domain: raw.domain, title, detail, cites: asCites(raw.cites, known) }];
  });
}

export function asSections(v: unknown, known: Set<number> = new Set()): SummarySection[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw) || !isDomain(raw.domain) || !Array.isArray(raw.bullets)) return [];
    const bullets = raw.bullets.flatMap((b): SummaryBullet[] => {
      // Legacy payloads stored bullets as plain strings.
      if (typeof b === "string") return b.trim() ? [{ text: b, cites: [] }] : [];
      if (!isRecord(b)) return [];
      const text = str(b.text);
      return text ? [{ text, cites: asCites(b.cites, known) }] : [];
    });
    if (bullets.length === 0) return [];
    return [{ domain: raw.domain, bullets }];
  });
}

/** Keep only the sources something still cites (an item may have been dropped). */
function citedOnly(sources: SummarySource[], cites: number[][]): SummarySource[] {
  const used = new Set(cites.flat());
  return sources.filter((s) => used.has(s.n));
}

export function asDay(payload: unknown): DaySummary | null {
  if (!isRecord(payload)) return null;
  const sources = asSources(payload.sources);
  const known = new Set(sources.map((s) => s.n));
  const yesterday = asItems(payload.yesterday, known);
  const today = asItems(payload.today, known);
  // A briefing with a headline but no items is an empty card, not a card.
  if (yesterday.length === 0 && today.length === 0) return null;
  return {
    headline: str(payload.headline),
    yesterday,
    today,
    sources: citedOnly(sources, [...yesterday, ...today].map((i) => i.cites)),
    model: str(payload.model),
    generatedAt: str(payload.generated_at),
  };
}

export function asWeek(payload: unknown): WeekSummary | null {
  if (!isRecord(payload)) return null;
  const sources = asSources(payload.sources);
  const known = new Set(sources.map((s) => s.n));
  const sections = asSections(payload.sections, known);
  if (sections.length === 0) return null;
  return {
    headline: str(payload.headline),
    sections,
    sources: citedOnly(
      sources,
      sections.flatMap((s) => s.bullets.map((b) => b.cites))
    ),
    model: str(payload.model),
    generatedAt: str(payload.generated_at),
  };
}
