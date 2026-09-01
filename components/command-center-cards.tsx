"use client";

import { Children, useEffect } from "react";
import Link from "next/link";
import { MasonryColumns, type PackHint } from "@/components/masonry-columns";
import { useSectionFilter } from "@/components/section-filter";

export type CardMeta = {
  section: string;
  /** Nav category this card belongs to — "markets", "sports", … */
  domain: string;
  label: string;
  href: string;
  accent: string;
};

/** Where a filtered category's ↗ leads, and what the bar is titled. */
const DOMAIN_META: Record<string, { label: string; href: string; accent: string }> = {
  news: { label: "News", href: "/news", accent: "hsl(220 90% 52%)" },
  sports: { label: "Sports", href: "/sports", accent: "hsl(25 95% 50%)" },
  markets: { label: "Markets", href: "/markets", accent: "hsl(142 65% 42%)" },
  media: { label: "Media", href: "/media", accent: "hsl(340 78% 50%)" },
  misc: { label: "Misc", href: "/misc", accent: "hsl(265 70% 55%)" },
};

/**
 * Command Center card list, with the phone-only category filter.
 *
 * The filter is driven by the nav (see CategoryNav): tapping SPORTS on a phone
 * narrows the dashboard to the sports cards rather than leaving the page. This
 * component only reads that state and renders the matching subset, plus a bar
 * carrying ↗ through to the category's own page.
 *
 * Desktop is untouched — the multi-column grid already shows everything, so
 * filtering would only get in the way.
 */
export function CommandCenterCards({
  meta,
  weights,
  hints,
  children,
}: {
  meta: CardMeta[];
  weights: number[];
  hints?: PackHint[];
  children: React.ReactNode;
}) {
  const { active, setActive } = useSectionFilter();

  const items = Children.toArray(children);
  const matching = active
    ? meta.flatMap((m, i) => (m.domain === active ? [i] : []))
    : [];
  const domain = active ? DOMAIN_META[active] : undefined;

  // Escape is the conventional way out of a filtered view on a keyboard.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, setActive]);

  if (active && domain && matching.length > 0) {
    return (
      <>
        <div className="sticky top-0 z-20 -mx-3 mb-2 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1 backdrop-blur">
          <button
            onClick={() => setActive(null)}
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            ← All cards
          </button>
          {/* One tap target: the words say where it goes, the box is the
              pop-out affordance. A card count added nothing the cards below
              did not already show. */}
          <Link
            href={domain.href}
            aria-label={`Open the ${domain.label} page`}
            className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors hover:opacity-80"
            style={{ color: domain.accent }}
          >
            All {domain.label}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-[10px]">
              ↗
            </span>
          </Link>
        </div>
        <div className="flex flex-col gap-3">{matching.map((i) => items[i])}</div>
      </>
    );
  }

  // A category with no cards right now (every league out of season, say)
  // should say so rather than silently showing the whole dashboard back.
  if (active && domain) {
    return (
      <>
        <div className="sticky top-0 z-20 -mx-3 mb-2 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1 backdrop-blur">
          <button
            onClick={() => setActive(null)}
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            ← All cards
          </button>
          <Link
            href={domain.href}
            aria-label={`Open the ${domain.label} page`}
            className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors hover:opacity-80"
            style={{ color: domain.accent }}
          >
            All {domain.label}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-[10px]">
              ↗
            </span>
          </Link>
        </div>
        <p className="border border-border p-8 text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          No {domain.label} cards right now
        </p>
      </>
    );
  }

  return (
    <MasonryColumns weights={weights} hints={hints}>
      {items}
    </MasonryColumns>
  );
}
