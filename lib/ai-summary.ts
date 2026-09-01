import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Typed access to the two AI briefings in `info_agg.misc_content`.
 *
 *  They share that table's untyped-JSONB storage (kind='summary', key 'day' or
 *  'week' — see supabase/11_ai_summaries.sql for why no new table), so as with
 *  lib/misc-content.ts this module is the only place that touches `payload`
 *  and the only place that knows the shape.
 *
 *  Kept separate from getMiscContent() on purpose: these are not misc cards.
 *  They summarise every domain, they render differently, and folding them into
 *  MiscContent would put them on /misc where they do not belong. */

/** The domain slugs the ETL constrains the model to (see DOMAINS in
 *  src/api/summary/summary_db_helper.py). Anything else is dropped rather than
 *  rendered, so a model that ignores its schema cannot reach the page. */
export const SUMMARY_DOMAINS = {
  us_news: { label: "US", accent: "hsl(220 90% 52%)" },
  world_news: { label: "World", accent: "hsl(265 70% 55%)" },
  sports: { label: "Sports", accent: "hsl(25 95% 50%)" },
  markets: { label: "MKTS", accent: "hsl(142 65% 42%)" },
  media: { label: "Media", accent: "hsl(340 78% 50%)" },
} as const;

export type SummaryDomain = keyof typeof SUMMARY_DOMAINS;

export type SummaryItem = {
  domain: SummaryDomain;
  title: string;
  detail: string;
};

export type SummarySection = {
  domain: SummaryDomain;
  bullets: string[];
};

export type DaySummary = {
  headline: string | null;
  yesterday: SummaryItem[];
  today: SummaryItem[];
  model: string | null;
  generatedAt: string | null;
};

export type WeekSummary = {
  headline: string | null;
  sections: SummarySection[];
  model: string | null;
  generatedAt: string | null;
};

export type AiSummaries = {
  day: DaySummary | null;
  week: WeekSummary | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isDomain = (v: unknown): v is SummaryDomain =>
  typeof v === "string" && v in SUMMARY_DOMAINS;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v : null;

function asItems(v: unknown): SummaryItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const title = str(raw.title);
    const detail = str(raw.detail);
    if (!isDomain(raw.domain) || !title || !detail) return [];
    return [{ domain: raw.domain, title, detail }];
  });
}

function asSections(v: unknown): SummarySection[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw) || !isDomain(raw.domain) || !Array.isArray(raw.bullets)) return [];
    const bullets = raw.bullets.filter(
      (b): b is string => typeof b === "string" && b.trim().length > 0
    );
    if (bullets.length === 0) return [];
    return [{ domain: raw.domain, bullets }];
  });
}

function asDay(payload: unknown): DaySummary | null {
  if (!isRecord(payload)) return null;
  const yesterday = asItems(payload.yesterday);
  const today = asItems(payload.today);
  // A briefing with a headline but no items is an empty card, not a card.
  if (yesterday.length === 0 && today.length === 0) return null;
  return {
    headline: str(payload.headline),
    yesterday,
    today,
    model: str(payload.model),
    generatedAt: str(payload.generated_at),
  };
}

function asWeek(payload: unknown): WeekSummary | null {
  if (!isRecord(payload)) return null;
  const sections = asSections(payload.sections);
  if (sections.length === 0) return null;
  return {
    headline: str(payload.headline),
    sections,
    model: str(payload.model),
    generatedAt: str(payload.generated_at),
  };
}

export async function getAiSummaries(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<AiSummaries> {
  const client = supabase ?? (await createClient());
  const { data } = await client
    .from("misc_content")
    .select("key, payload")
    .eq("kind", "summary");

  const rows = (data ?? []) as { key: string; payload: unknown }[];
  const byKey = (key: string) => rows.find((r) => r.key === key)?.payload;

  return {
    day: asDay(byKey("day")),
    week: asWeek(byKey("week")),
  };
}
