"use client";

import { useState } from "react";
import Link from "next/link";

interface CollapsibleCardProps {
  label: string;
  accent: string;
  href: string;
  count?: number;
  /** Retained for call-site compatibility; the header shows only the count. */
  summary?: string;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  /** Optional icon rendered between the accent bar and the label text */
  icon?: React.ReactNode;
  /** Optional element rendered in the header row, before the "All →" link
   *  (e.g. a single source pill covering every item in the card). */
  headerExtra?: React.ReactNode;
  /**
   * Retained for call-site compatibility; cards no longer scroll internally —
   * content determines height, so callers cap their item counts instead.
   */
  contentHeight?: "full" | "half";
}

export function CollapsibleCard({
  label,
  accent,
  href,
  count,
  children,
  className,
  defaultOpen = true,
  icon,
  headerExtra,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`border border-border bg-card${className ? ` ${className}` : ""}`}>
      {/* Header — always visible */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left group"
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
        >
          <div className="w-1 h-3 shrink-0" style={{ backgroundColor: accent }} />
          {icon && (
            <span className="shrink-0" style={{ color: accent }}>
              {icon}
            </span>
          )}
          <span
            className="text-[9px] font-mono tracking-wider uppercase font-bold truncate"
            style={{ color: accent }}
          >
            {label}
          </span>
          <span className="text-[9px] font-mono text-muted-foreground shrink-0 ml-1 group-hover:text-foreground transition-colors">
            {open ? "▲" : "▼"}
          </span>
          {count != null && (
            <span className="text-[9px] font-mono text-muted-foreground shrink-0">{count}</span>
          )}
        </button>
        {headerExtra && <span className="shrink-0 ml-2">{headerExtra}</span>}
        <Link
          href={href}
          className="text-[9px] font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
        >
          All →
        </Link>
      </div>

      {/*
        CSS grid-template-rows collapse animation (250ms).
        Inner div needs min-h-0 + overflow-hidden to fully collapse.
        Content wrapper height is driven by contentHeight prop.
      */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 250ms ease",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
