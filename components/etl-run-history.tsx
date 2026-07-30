"use client";

import { useState } from "react";
import { EtlRunBreakdown } from "@/components/etl-run-breakdown";
import { STATUS_COLOR, type EtlRun } from "@/lib/etl-runs";
import { formatTime } from "@/lib/format-date";

/**
 * Run history where each row expands into the same per-domain breakdown the
 * "Latest ETL Run" panel shows — so any past run can be inspected without
 * leaving the page, not just the most recent one.
 */
export function EtlRunHistory({ runs }: { runs: EtlRun[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (runs.length === 0) {
    return <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">No runs recorded.</p>;
  }

  return (
    <div>
      {runs.map((r) => {
        const open = openId === r.id;
        const statusColor = STATUS_COLOR[r.status] ?? "hsl(0 0% 50%)";
        return (
          <div key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : r.id)}
              aria-expanded={open}
              title={open ? "Hide run breakdown" : "Show run breakdown"}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 border-l-[3px]
                border-b-2 border-b-muted-foreground/30 transition-colors
                ${open ? "bg-secondary/70" : "bg-secondary/40 hover:bg-secondary/60"}`}
              style={{ borderLeftColor: statusColor }}
            >
              <span
                className="text-[9px] font-mono text-muted-foreground shrink-0 w-2"
                aria-hidden
              >
                {open ? "▾" : "▸"}
              </span>
              <span className="text-[10px] font-mono tabular-nums shrink-0">
                {formatTime(r.started_at)}
              </span>
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
                {r.tier}
              </span>
              <span
                className="text-[9px] font-mono uppercase tracking-wider font-bold shrink-0"
                style={{ color: statusColor }}
              >
                {r.status}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums ml-auto shrink-0">
                {r.duration_seconds != null ? `${r.duration_seconds}s` : "—"}
              </span>
              {r.errors.length > 0 && (
                <span
                  className="text-[9px] font-mono tabular-nums shrink-0"
                  style={{ color: "hsl(45 90% 45%)" }}
                  title={`${r.errors.length} errors`}
                >
                  {r.errors.length}⚠
                </span>
              )}
            </button>

            {open && (
              <div className="border-b-2 border-b-muted-foreground/30 bg-background">
                <div className="px-2 py-1.5 flex items-center gap-2 flex-wrap border-b border-border">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                    {r.tier} · {r.triggered_by}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
                    {formatTime(r.started_at, true)}
                    {r.finished_at && ` → ${formatTime(r.finished_at)}`}
                  </span>
                </div>
                <EtlRunBreakdown run={r} maxErrors={3} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
