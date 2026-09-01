import Link from "next/link";
import { getAiSummaries } from "@/lib/ai-summary";
import {
  AI_ACCENT,
  DaySummaryFull,
  SummaryProvenance,
  WeekSummaryFull,
} from "@/components/ai-summary-cards";

/** The AI briefings, in full.
 *
 *  Deliberately absent from NAV_LINKS: this page is reached only from the two
 *  Command Center cards' "All →". Those cards clamp their rows to stay compact
 *  beside twenty others, and their hover tooltips are unreachable on touch —
 *  so this is where the briefing can actually be read end to end. Giving it a
 *  nav slot would also imply a sixth category to the mobile filter, which it
 *  is not: these summarise the other five.
 */
export default async function SummaryPage() {
  const { day, week } = await getAiSummaries();

  const covered = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
      : null;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-8">
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between gap-3">
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            <span style={{ color: AI_ACCENT }}>◈</span> BRIEFING
          </h2>
          <Link
            href="/"
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            ← Command Center
          </Link>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          AI-GENERATED FROM THE SITE&apos;S OWN DATA · US · WORLD · SPORTS · MKTS · MEDIA
        </p>
      </div>

      {!day && !week ? (
        <div className="border border-border p-12 text-center">
          <p className="text-sm font-mono text-muted-foreground">
            No briefing yet — the next daily ETL run will write one.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          {day && (
            <section className="border border-border bg-card">
              <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-border">
                <h3
                  className="text-[10px] font-mono font-bold uppercase tracking-wider"
                  style={{ color: AI_ACCENT }}
                >
                  Summary of the Day
                </h3>
                {covered(day.generatedAt) && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {covered(day.generatedAt)}
                  </span>
                )}
              </div>
              <div className="px-3 py-3">
                <DaySummaryFull summary={day} />
              </div>
              <SummaryProvenance model={day.model} generatedAt={day.generatedAt} />
            </section>
          )}

          {week && (
            <section className="border border-border bg-card">
              <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-border">
                <h3
                  className="text-[10px] font-mono font-bold uppercase tracking-wider"
                  style={{ color: AI_ACCENT }}
                >
                  Summary of the Week
                </h3>
                {covered(week.generatedAt) && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    week to {covered(week.generatedAt)}
                  </span>
                )}
              </div>
              <div className="px-3 py-3">
                <WeekSummaryFull summary={week} />
              </div>
              <SummaryProvenance model={week.model} generatedAt={week.generatedAt} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
