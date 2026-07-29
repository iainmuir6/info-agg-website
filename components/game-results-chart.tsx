"use client";

import { useState } from "react";

export type GameResultBar = {
  id: string;
  /** ISO timestamp of the game */
  date: string | null;
  isHome: boolean;
  own: number;
  opp: number;
  oppAbbrev: string;
  /** Box score link (ESPN gamecast); null when we have no event id */
  url: string | null;
};

const WIN = "hsl(142 65% 42%)";
const LOSS = "hsl(0 72% 50%)";
const TIE = "hsl(var(--muted-foreground))";

/** Pixels of bar area above and below the zero line. Wins get more room
 *  because blowout wins and blowout losses are equally likely but the eye
 *  reads the upper half first. */
const UP_H = 58;
const DOWN_H = 44;

function easternParts(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA → "2026-07-29", sortable and unambiguous
  const key = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return {
    monthKey: key.slice(0, 7),
    monthLabel: d.toLocaleDateString("en-US", { month: "short", timeZone: "America/New_York" }),
    dayLabel: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }),
  };
}

/**
 * Season margin-of-victory strip: one bar per completed game, oldest on the
 * left. Green above the zero line is a win, red below is a loss, and bar height
 * is the margin. Bars are grouped into months, each month underscored.
 *
 * Wins and losses share ONE pixels-per-run scale rather than each filling its
 * own half. Scaling the halves independently would make a 3-run win and a
 * 12-run loss draw the same length, which is exactly the comparison the chart
 * exists to support.
 */
export function GameResultsChart({ games }: { games: GameResultBar[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (games.length === 0) return null;

  const margins = games.map((g) => g.own - g.opp);
  const maxWin = Math.max(0, ...margins);
  const maxLoss = Math.max(0, ...margins.map((m) => -m));
  // One scale for both directions; fall back so a team with only wins (or only
  // losses) still fills its half instead of dividing by zero.
  const scale = Math.min(
    maxWin > 0 ? UP_H / maxWin : Infinity,
    maxLoss > 0 ? DOWN_H / maxLoss : Infinity,
  );
  const px = (margin: number) =>
    Math.max(2, Math.round(Math.abs(margin) * (Number.isFinite(scale) ? scale : 1)));

  // Group into months, preserving chronological order
  const groups: { monthKey: string; monthLabel: string; items: { g: GameResultBar; i: number }[] }[] = [];
  games.forEach((g, i) => {
    const parts = easternParts(g.date);
    const monthKey = parts?.monthKey ?? "unknown";
    const monthLabel = parts?.monthLabel ?? "—";
    const last = groups[groups.length - 1];
    if (last && last.monthKey === monthKey) last.items.push({ g, i });
    else groups.push({ monthKey, monthLabel, items: [{ g, i }] });
  });

  const active = hover != null ? games[hover] : null;
  const activeMargin = active ? active.own - active.opp : 0;
  const activeParts = active ? easternParts(active.date) : null;
  // Clamped so the readout can't overhang either end of the strip.
  const activeLeft = hover != null ? Math.min(92, Math.max(8, ((hover + 0.5) / games.length) * 100)) : 0;

  const record = margins.reduce(
    (acc, m) => (m > 0 ? { ...acc, w: acc.w + 1 } : m < 0 ? { ...acc, l: acc.l + 1 } : { ...acc, t: acc.t + 1 }),
    { w: 0, l: 0, t: 0 },
  );

  return (
    <section>
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        <p className="text-[10px] font-mono tracking-widest uppercase font-bold" style={{ color: "hsl(var(--favorite))" }}>
          Game Results
        </p>
        <p className="text-[9px] font-mono text-muted-foreground">
          Bar height is margin of victory · hover for detail · click for box score · grouped by month
        </p>
        <p className="text-[9px] font-mono text-muted-foreground ml-auto tabular-nums">
          {games.length} games · {record.w}–{record.l}
          {record.t > 0 ? `–${record.t}` : ""}
        </p>
      </div>

      <div className="border border-border bg-background px-2 pt-2 pb-1">
        <div className="relative">
          {/* Floating readout for the hovered bar */}
          {active && (
            <div
              className="pointer-events-none absolute -top-1 z-20 -translate-x-1/2 border border-border bg-background px-2 py-1 shadow-sm whitespace-nowrap"
              style={{ left: `${activeLeft}%` }}
            >
              <p className="text-[9px] font-mono text-muted-foreground leading-none">
                {activeParts?.dayLabel} · {active.isHome ? "vs" : "@"} {active.oppAbbrev}
              </p>
              <p className="text-[11px] font-mono font-bold leading-tight tabular-nums">
                <span style={{ color: activeMargin > 0 ? WIN : activeMargin < 0 ? LOSS : undefined }}>
                  {activeMargin > 0 ? "W" : activeMargin < 0 ? "L" : "T"}
                </span>{" "}
                {active.own}–{active.opp}
                <span className="text-muted-foreground font-normal">
                  {activeMargin !== 0 ? ` (${activeMargin > 0 ? "+" : "−"}${Math.abs(activeMargin)})` : ""}
                </span>
              </p>
            </div>
          )}

          {/* Zero line, drawn once across every month group so all bars share
              one baseline regardless of grouping */}
          <div
            className="absolute left-0 right-0 border-t border-dashed border-foreground/40 z-10 pointer-events-none"
            style={{ top: UP_H }}
          />

          <div
            className="flex items-stretch gap-2 sm:gap-3"
            onMouseLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
          >
            {groups.map((group) => (
              <div key={group.monthKey} className="flex flex-col min-w-0" style={{ flexGrow: group.items.length, flexBasis: 0 }}>
                <div className="flex items-stretch gap-px min-w-0">
                  {group.items.map(({ g, i }) => {
                    const margin = g.own - g.opp;
                    const h = px(margin);
                    const color = margin > 0 ? WIN : margin < 0 ? LOSS : TIE;
                    const label = `${easternParts(g.date)?.dayLabel ?? ""} ${g.isHome ? "vs" : "@"} ${g.oppAbbrev} — ${
                      margin > 0 ? "W" : margin < 0 ? "L" : "T"
                    } ${g.own}-${g.opp}`;
                    const bar = (
                      <>
                        <div style={{ height: UP_H }} className="flex items-end">
                          {margin >= 0 && (
                            <div className="w-full transition-opacity" style={{ height: h, backgroundColor: color, opacity: hover == null || hover === i ? 1 : 0.55 }} />
                          )}
                        </div>
                        <div style={{ height: DOWN_H }} className="flex items-start">
                          {margin < 0 && (
                            <div className="w-full transition-opacity" style={{ height: h, backgroundColor: color, opacity: hover == null || hover === i ? 1 : 0.55 }} />
                          )}
                        </div>
                      </>
                    );

                    const shared = {
                      className: "flex flex-col min-w-0 flex-1 basis-0",
                      onMouseEnter: () => setHover(i),
                      onFocus: () => setHover(i),
                      title: label,
                    };

                    return g.url ? (
                      <a
                        key={g.id}
                        {...shared}
                        href={g.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${label} — open box score`}
                      >
                        {bar}
                      </a>
                    ) : (
                      <div key={g.id} {...shared} aria-label={label}>
                        {bar}
                      </div>
                    );
                  })}
                </div>
                {/* Month rule + label */}
                <div className="border-t border-border mt-1 pt-0.5">
                  <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground/70 text-center truncate">
                    {group.monthLabel}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
