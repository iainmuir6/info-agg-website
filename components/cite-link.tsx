"use client";

import Link from "next/link";
import { useState } from "react";
import { isInternalSourceUrl, type SummarySource } from "@/lib/ai-summary-parse";

const KIND_LABEL: Record<SummarySource["kind"], string> = {
  article: "Article",
  market: "Market News",
  quote: "Quote",
  game: "Box Score",
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const PANEL_W = 280;

/**
 * One [n] citation marker. With a mouse, hovering previews the source in a
 * card above the marker; clicking opens it (new tab for outside sources, same
 * tab for the site's own ticker pages). Touch has no hover, so a tap just
 * opens the source.
 *
 * Fixed, not absolute, for the same reason as HoverReveal: the cards clip
 * their bodies with overflow-hidden. The preview sits ABOVE the marker so it
 * never covers HoverReveal's row panel, which opens below the row.
 */
export function CiteLink({
  n,
  source,
  color,
}: {
  n: number;
  source: SummarySource;
  color: string;
}) {
  const [box, setBox] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const internal = isInternalSourceUrl(source.url);
  const host = internal ? "Info Hub" : hostOf(source.url);
  const meta = [source.outlet ?? host, KIND_LABEL[source.kind]].filter(Boolean).join(" · ");

  const show = (e: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    if ("pointerType" in e && e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    setBox({ left: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };
  const hide = () => setBox(null);

  const common = {
    "aria-label": `Source ${n}: ${source.title}`,
    className:
      "relative hover:underline focus-visible:underline focus-visible:outline-none after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']",
    style: { color },
    onPointerEnter: show,
    onPointerLeave: hide,
    onFocus: show,
    onBlur: hide,
    onClick: hide,
  };

  const marker = <>[{n}]</>;

  return (
    <>
      {internal ? (
        <Link href={source.url} {...common}>
          {marker}
        </Link>
      ) : (
        <a href={source.url} target="_blank" rel="noopener noreferrer" {...common}>
          {marker}
        </a>
      )}
      {box && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[60] block whitespace-normal border border-border bg-card p-2 text-left font-sans text-[12px] leading-snug shadow-lg"
          style={{
            width: PANEL_W,
            left: Math.max(8, Math.min(box.left - PANEL_W / 2, window.innerWidth - PANEL_W - 8)),
            // Above the marker; below it only when the marker is near the top.
            ...(box.top > 110
              ? { bottom: window.innerHeight - box.top + 6 }
              : { top: box.bottom + 6 }),
          }}
        >
          <span className="block font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            [{n}] {meta}
          </span>
          <span className="mt-1 line-clamp-3 block text-[12px] leading-snug text-foreground">
            {source.title}
          </span>
        </span>
      )}
    </>
  );
}
