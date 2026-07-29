"use client";

import { useState } from "react";
import Link from "next/link";
import type { StandingsGroup } from "@/lib/standings";

/** Collapsed-by-default "Standings" reveal nested inside a homepage sports
 *  card — top 5 teams per conference (or top 5 overall with no conference
 *  split). Mirrors CollapsibleCard's own grid-template-rows toggle so nested
 *  expand/collapse reads as the same interaction. */
export function StandingsExpander({
  groups,
  leagueSlug,
}: {
  groups: StandingsGroup[];
  leagueSlug: string;
}) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1 text-left hover:bg-secondary/50 transition-colors"
        aria-label={open ? "Collapse standings" : "Expand standings"}
      >
        <span className="text-[9px] font-mono tracking-wider uppercase text-muted-foreground">
          Standings
        </span>
        <span className="text-[9px] font-mono text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 250ms ease",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-2 pb-2 space-y-2">
            {groups.map((group) => (
              <div key={group.conference ?? "all"}>
                {group.conference && (
                  <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground/70 px-1 py-0.5">
                    {group.conference}
                  </p>
                )}
                <div className="divide-y divide-border">
                  {group.teams.map((t) => (
                    <Link
                      key={t.team_abbrev}
                      href={`/${leagueSlug}/${t.team_abbrev}`}
                      className="flex items-center justify-between gap-2 px-1 py-1 text-[10px] font-mono hover:bg-secondary/50 transition-colors"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {t.logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.logo} alt="" className="w-3.5 h-3.5 shrink-0 object-contain" />
                        )}
                        <span className="truncate">{t.team_name ?? t.team_abbrev}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {t.wins ?? "–"}-{t.losses ?? "–"}
                        {t.ties != null ? `-${t.ties}` : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
