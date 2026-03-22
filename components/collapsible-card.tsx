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
}

export function CollapsibleCard({
  label,
  accent,
  href,
  count,
  summary,
  children,
  className,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`border border-border bg-card${className ? ` ${className}` : ""}`}>
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border">
        {/* Left: clickable toggle area */}
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
          <span
            className="text-[9px] font-mono text-muted-foreground shrink-0 ml-1 group-hover:text-foreground transition-colors"
          >
            {open ? "▲" : "▼"}
          </span>
          {!open && summary && (
            <span className="text-[9px] font-mono text-muted-foreground truncate ml-1">
              {summary}
            </span>
          )}
        </button>
        {/* Right: navigation link */}
        <Link
          href={href}
          className="text-[9px] font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
        >
          All →
        </Link>
      </div>
      {open && children}
    </div>
  );
}
