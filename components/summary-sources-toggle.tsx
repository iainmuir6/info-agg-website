"use client";

import { useId, useState } from "react";

/** Collapsed "Sources · N" row under a Command Center briefing card.
 *
 *  Closed by default so the card stays as compact as it was before citations.
 *  Opens on its height with the same grid-template-rows trick CollapsibleCard
 *  uses; the transition is dropped under Reduce Motion. The list itself is
 *  rendered on the server and passed in as children. */
export function SummarySourcesToggle({
  count,
  accent,
  children,
}: {
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="group flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <span
          className="text-[8px] font-mono font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          Sources · {count}
        </span>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[8px] font-mono text-muted-foreground group-hover:text-foreground transition-colors">
          {open ? "▲" : "▼"}
        </span>
      </button>
      <div
        id={id}
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        // Closed rows must not be reachable by Tab.
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
