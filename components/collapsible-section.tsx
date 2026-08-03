"use client";

import { useState, type ReactNode } from "react";

type Props = {
  /** Section label, e.g. "▶ YouTube — Trending". */
  title: string;
  /** Accent colour for the label and the left border rule. */
  accent: string;
  /** Small muted text after the title, e.g. "24 videos". */
  meta?: string;
  /** Collapsed sections still receive their children from the server; they
   *  simply are not mounted, so embedded iframes cost nothing until opened. */
  defaultOpen?: boolean;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  accent,
  meta,
  defaultOpen = true,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="bg-background lg:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-3 border-b border-border hover:bg-secondary transition-colors text-left"
        style={{ borderLeftWidth: "3px", borderLeftColor: accent }}
      >
        <span
          className="text-xs font-mono font-bold tracking-widest uppercase"
          style={{ color: accent }}
        >
          {title}
        </span>
        {meta && (
          <span className="text-[10px] font-mono text-muted-foreground">{meta}</span>
        )}
        <span
          aria-hidden
          className="ml-auto text-[10px] font-mono text-muted-foreground transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          ▶
        </span>
      </button>
      {open && children}
    </section>
  );
}
