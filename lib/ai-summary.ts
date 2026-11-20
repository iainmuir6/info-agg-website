import "server-only";
import { createClient } from "@/lib/supabase/server";
import { asDay, asWeek, type AiSummaries } from "@/lib/ai-summary-parse";

/** Typed access to the two AI briefings in `info_agg.misc_content`.
 *
 *  They share that table's untyped-JSONB storage (kind='summary', key 'day' or
 *  'week' — see supabase/11_ai_summaries.sql for why no new table), so as with
 *  lib/misc-content.ts this module is the only place that reads `payload`; the
 *  shape rules live in lib/ai-summary-parse.ts (pure, tested).
 *
 *  Kept separate from getMiscContent() on purpose: these are not misc cards.
 *  They summarise every domain, they render differently, and folding them into
 *  MiscContent would put them on /misc where they do not belong. */

export {
  SUMMARY_DOMAINS,
  type AiSummaries,
  type DaySummary,
  type SummaryBullet,
  type SummaryDomain,
  type SummaryItem,
  type SummarySection,
  type SummarySource,
  type WeekSummary,
} from "@/lib/ai-summary-parse";

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
