import {
  SUMMARY_DOMAINS,
  type DaySummary,
  type SummaryDomain,
  type SummaryItem,
  type WeekSummary,
} from "@/lib/ai-summary";
import { HoverReveal } from "@/components/hover-reveal";

/** Distinct from every nav accent: these cards belong to no single category,
 *  and colouring them like one would imply they only cover it. */
export const AI_ACCENT = "hsl(190 85% 42%)";

/** Width of the pill column, in `ch`, derived from the longest domain label
 *  rather than hardcoded. Every pill gets this width, so the detail text
 *  beside them starts on one vertical line instead of stepping in and out as
 *  the domain changes down the list. Deriving it means renaming a label (or
 *  adding a domain) re-measures the column instead of silently overflowing a
 *  fixed value — which is exactly what a literal `min-w-[6ch]` did to
 *  "Markets" before it was shortened to "MKTS". */
const PILL_CH = Math.max(
  ...Object.values(SUMMARY_DOMAINS).map((d) => d.label.length)
);

/** Domain tag. Carries its own domain's colour rather than the card accent, so
 *  a glance down the list shows the spread of what the briefing covers. */
function DomainPill({ domain }: { domain: SummaryDomain }) {
  const { label, accent } = SUMMARY_DOMAINS[domain];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center px-1 py-0.5 rounded text-[7px] font-mono uppercase leading-none tracking-wide"
      style={{
        background: `color-mix(in srgb, ${accent} 15%, transparent)`,
        color: accent,
        // border-box means width includes the px-1 padding, and the mono font
        // makes `ch` exact — so add the padding back rather than letting the
        // longest label be squeezed. The extra 2px covers `tracking-wide`,
        // whose 0.025em per character `ch` does not account for; without it
        // the longest label (SPORTS) overflows its own box by about a pixel.
        width: `calc(${PILL_CH}ch + 0.5rem + 2px)`,
      }}
    >
      {label}
    </span>
  );
}

/** Section rule inside a card — "YESTERDAY" / "TODAY". */
function Rule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
      <span
        className="text-[8px] font-mono font-bold uppercase tracking-wider"
        style={{ color: AI_ACCENT }}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function ItemRow({ item }: { item: SummaryItem }) {
  return (
    <div className="flex gap-1.5 items-start px-2 py-1 border-b border-border last:border-0">
      {/* Pill in its own column so the detail text wraps beside it, matching
          the Word/Wiki/Fact rows on the Misc card. */}
      <span className="pt-[3px]">
        <DomainPill domain={item.domain} />
      </span>
      {/* The clamps keep these cards compact, but they hide text the reader
          has no other way to reach here. HoverReveal shows the row in full on
          hover; /summary carries the same content for touch, where there is
          no hover at all. */}
      <HoverReveal
        className="min-w-0"
        content={
          <>
            <span className="mb-1 block">
              <DomainPill domain={item.domain} />
            </span>
            <p className="text-xs font-semibold leading-snug">{item.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {item.detail}
            </p>
          </>
        }
      >
        <p className="text-[10px] font-semibold leading-[13px] line-clamp-1">
          {item.title}
        </p>
        <p className="text-[10px] leading-[13px] text-muted-foreground line-clamp-2">
          {item.detail}
        </p>
      </HoverReveal>
    </div>
  );
}

/** Shared footer: says what wrote this and when.
 *
 *  Not decoration — these cards are model-generated and everything else on the
 *  dashboard is fetched, so the provenance is the reader's cue to weigh them
 *  differently. It also surfaces staleness: on a Gemini outage the ETL keeps
 *  the previous briefing rather than emptying the card, and without a visible
 *  timestamp yesterday's briefing would read as today's. */
function Provenance({ model, generatedAt }: { model: string | null; generatedAt: string | null }) {
  if (!model && !generatedAt) return null;
  const when = generatedAt
    ? new Date(generatedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-t border-border">
      <span className="text-[7px] font-mono uppercase tracking-wider text-muted-foreground">
        AI-generated{model ? ` · ${model}` : ""}
      </span>
      {when && (
        <span className="ml-auto text-[7px] font-mono uppercase tracking-wider text-muted-foreground tabular-nums">
          {when}
        </span>
      )}
    </div>
  );
}

function Headline({ text }: { text: string }) {
  return (
    <p
      className="px-2 pt-2 pb-0.5 text-[12px] font-black leading-[15px]"
      style={{ fontFamily: "Georgia, serif" }}
      title={text}
    >
      {text}
    </p>
  );
}

/** Summary of the Day — what happened, then what to watch. */
export function DaySummaryMini({ summary }: { summary: DaySummary }) {
  return (
    <div>
      {summary.headline && <Headline text={summary.headline} />}

      {summary.yesterday.length > 0 && (
        <>
          <Rule label="Yesterday" />
          {summary.yesterday.map((item, i) => (
            <ItemRow key={`y-${i}`} item={item} />
          ))}
        </>
      )}

      {/* The lookahead is grounded in scheduled games, upcoming holidays and
          unresolved threads, so it is legitimately short some days and absent
          on others. Rendering the rule only when there is something under it
          beats an empty "TODAY" heading. */}
      {summary.today.length > 0 && (
        <>
          <Rule label="What to watch" />
          {summary.today.map((item, i) => (
            <ItemRow key={`t-${i}`} item={item} />
          ))}
        </>
      )}

      <Provenance model={summary.model} generatedAt={summary.generatedAt} />
    </div>
  );
}

/** Summary of the Week — one block per domain that had real material. */
export function WeekSummaryMini({ summary }: { summary: WeekSummary }) {
  return (
    <div>
      {summary.headline && <Headline text={summary.headline} />}

      {summary.sections.map((section) => (
        <div key={section.domain} className="border-b border-border last:border-0">
          <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
            <DomainPill domain={section.domain} />
            <span className="h-px flex-1 bg-border" />
          </div>
          {section.bullets.map((bullet, i) => (
            <div key={i} className="flex gap-1.5 items-start px-2 pb-1 last:pb-1.5">
              <span
                className="shrink-0 text-[10px] leading-[13px]"
                style={{ color: SUMMARY_DOMAINS[section.domain].accent }}
              >
                ·
              </span>
              <p className="text-[10px] leading-[13px] text-muted-foreground">{bullet}</p>
            </div>
          ))}
        </div>
      ))}

      <Provenance model={summary.model} generatedAt={summary.generatedAt} />
    </div>
  );
}

// ── Full-size variants, for /summary ─────────────────────────────────────────
//
// The dashboard minis clamp titles to one line and details to two so the cards
// stay compact next to everything else. These do not clamp at all: the page
// exists precisely so the briefing can be read whole, including on touch
// devices where the minis' hover tooltips are unreachable.

function FullItem({ item }: { item: SummaryItem }) {
  return (
    <div className="flex gap-2 items-start py-2 border-b border-border last:border-0">
      <span className="pt-[3px]">
        <DomainPill domain={item.domain} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">{item.title}</p>
        <p className="text-sm leading-snug text-muted-foreground mt-0.5">{item.detail}</p>
      </div>
    </div>
  );
}

function FullHeading({ label }: { label: string }) {
  return (
    <h3
      className="text-[10px] font-mono font-bold uppercase tracking-wider mb-1"
      style={{ color: AI_ACCENT }}
    >
      {label}
    </h3>
  );
}

export function DaySummaryFull({ summary }: { summary: DaySummary }) {
  return (
    <div className="space-y-4">
      {summary.headline && (
        <p className="text-xl font-black leading-tight" style={{ fontFamily: "Georgia, serif" }}>
          {summary.headline}
        </p>
      )}
      {summary.yesterday.length > 0 && (
        <div>
          <FullHeading label="Yesterday" />
          {summary.yesterday.map((item, i) => (
            <FullItem key={`y-${i}`} item={item} />
          ))}
        </div>
      )}
      {summary.today.length > 0 && (
        <div>
          <FullHeading label="What to watch" />
          {summary.today.map((item, i) => (
            <FullItem key={`t-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WeekSummaryFull({ summary }: { summary: WeekSummary }) {
  return (
    <div className="space-y-4">
      {summary.headline && (
        <p className="text-xl font-black leading-tight" style={{ fontFamily: "Georgia, serif" }}>
          {summary.headline}
        </p>
      )}
      {summary.sections.map((section) => (
        <div key={section.domain}>
          <div className="mb-1">
            <DomainPill domain={section.domain} />
          </div>
          <ul className="space-y-1">
            {section.bullets.map((bullet, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span
                  className="shrink-0 text-sm leading-snug"
                  style={{ color: SUMMARY_DOMAINS[section.domain].accent }}
                >
                  ·
                </span>
                <p className="text-sm leading-snug text-muted-foreground">{bullet}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Shared provenance line, exported so /summary states it as plainly as the
 *  cards do — the reader should never have to guess which text is generated. */
export function SummaryProvenance({
  model,
  generatedAt,
}: {
  model: string | null;
  generatedAt: string | null;
}) {
  return <Provenance model={model} generatedAt={generatedAt} />;
}
