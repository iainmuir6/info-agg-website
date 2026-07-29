"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TickerShell } from "@/components/ticker-shell";

export type SportsTickerItem = {
  id: string;
  league: string;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  state: "final" | "live" | "scheduled";
  detail: string;
};

const POLL_INTERVAL_MS = 60_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeSportsRows(rows: any[]): SportsTickerItem[] {
  return (rows ?? []).map((r: any) => {
    const status = (r.status ?? "").toLowerCase();
    const isFinal = status.includes("final");
    const isLive = !isFinal && (status.includes("progress") || status.includes("live"));
    const tip = r.game_date
      ? new Date(r.game_date).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        })
      : "";
    return {
      id: r.id,
      league: (r.leagues?.league ?? "").toUpperCase(),
      away: r.away_abbrev ?? (r.away_team ?? "").slice(0, 3).toUpperCase(),
      home: r.home_abbrev ?? (r.home_team ?? "").slice(0, 3).toUpperCase(),
      awayScore: r.away_score,
      homeScore: r.home_score,
      state: isFinal ? "final" : isLive ? "live" : "scheduled",
      detail: isFinal ? "F" : isLive ? (r.status_detail ?? "LIVE") : tip,
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function SportsTickerClient({ items: initialItems }: { items: SportsTickerItem[] }) {
  const [items, setItems] = useState<SportsTickerItem[]>(initialItems);

  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("sports_scores")
        .select("id, home_team, away_team, home_abbrev, away_abbrev, home_score, away_score, status, status_detail, game_date, leagues(league)")
        .gte("game_date", new Date(Date.now() - 36 * 3600 * 1000).toISOString())
        .lte("game_date", new Date(Date.now() + 24 * 3600 * 1000).toISOString())
        .order("game_date", { ascending: false })
        .limit(30);
      const next = normalizeSportsRows(data ?? []);
      if (next.length > 0) setItems(next);
    } catch {
      // keep the last good snapshot
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (items.length === 0) return null;

  const looped = [...items, ...items];

  return (
    <TickerShell label="Sports" className="bg-secondary/20">
      <div
        className="animate-ticker flex items-center"
        style={{ animationDuration: `${Math.max(40, items.length * 5)}s` }}
      >
        {looped.map((g, i) => (
          <span
            key={`${g.id}-${i}`}
            className="inline-flex items-center gap-1.5 px-3 sm:px-4 shrink-0 text-[10px] sm:text-xs font-mono"
            aria-hidden={i >= items.length}
          >
            <span className="text-muted-foreground text-[8px] sm:text-[9px]">{g.league}</span>
            <span className="font-bold">{g.away}</span>
            {g.state !== "scheduled" && <span className="tabular-nums">{g.awayScore ?? "–"}</span>}
            <span className="text-muted-foreground/60">{g.state === "scheduled" ? "@" : "–"}</span>
            {g.state !== "scheduled" && <span className="tabular-nums">{g.homeScore ?? "–"}</span>}
            <span className="font-bold">{g.home}</span>
            <span
              className="text-[8px] sm:text-[9px]"
              style={{
                color: g.state === "live" ? "hsl(142 65% 42%)" : "hsl(var(--muted-foreground))",
              }}
            >
              {g.detail}
            </span>
            <span className="text-muted-foreground/30 ml-1">·</span>
          </span>
        ))}
      </div>
    </TickerShell>
  );
}
