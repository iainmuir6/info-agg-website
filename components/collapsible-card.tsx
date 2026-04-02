"use client";

import { useState } from "react";
import Link from "next/link";

interface CollapsibleCardProps {
  label: string;
  accent: string;
  href: string;
  count?: number;
  summary?: string;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

export function CollapsibleCard({
  label,
  accent,
  href,
  count,
  summary,
  children,
  className,
  defaultOpen = true,
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
        >
          <div className="w-1 h-3 shrink-0" style={{ backgroundColor: accent }} />
          <span
            className="text-[9px] font-mono tracking-wider uppercase font-bold truncate"
            style={{ color: accent }}
          >
            {label}
          </span>
          {count != null && (
            <span className="text-[9px] font-mono text-muted-foreground shrink-0">{count}</span>
          )}
          <span className="text-[9px] font-mono text-muted-foreground shrink-0 ml-1 group-hover:text-foreground transition-colors">
            {open ? "▲" : "▼"}
          </span>
          {!open && summary && (
            <span className="text-[9px] font-mono text-muted-foreground truncate ml-1">
              {summary}
            </span>
          )}
        </button>
        <Link
          href={href}
          className="text-[9px] font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
        >
          All →
        </Link>
      </div>

      {/*
        Animated collapse via CSS grid-template-rows trick:
        1fr → content full height, 0fr → content zero height.
        The inner div needs min-h-0 + overflow-hidden so it fully collapses.
        The content wrapper is a fixed h-72 (288px) so every card is the same size.
      */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 250ms ease",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="h-72">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
