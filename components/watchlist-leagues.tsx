"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type League = {
  id: string;
  display_name: string;
  sport: string;
  tracked: boolean;
};

type Props = {
  initialLeagues: League[];
};

export function WatchlistLeagues({ initialLeagues }: Props) {
  const [leagues, setLeagues] = useState<League[]>(initialLeagues);

  async function handleToggle(league: League) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (league.tracked) {
      await supabase
        .from("watchlist_leagues")
        .delete()
        .eq("league_id", league.id);
    } else {
      await supabase
        .from("watchlist_leagues")
        .insert({ league_id: league.id, user_id: user?.id });
    }

    setLeagues((prev) =>
      prev.map((l) => l.id === league.id ? { ...l, tracked: !l.tracked } : l)
    );
  }

  return (
    <div className="border border-border">
      <div className="px-3 py-1.5 border-b border-border" style={{ borderLeftColor: "hsl(25 95% 50%)", borderLeftWidth: 3 }}>
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">Tracked Leagues</span>
      </div>

      {leagues.length === 0 ? (
        <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">
          No leagues available
        </p>
      ) : (
        <div className="divide-y divide-border">
          {leagues.map((l) => (
            <label
              key={l.id}
              className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <input
                type="checkbox"
                checked={l.tracked}
                onChange={() => handleToggle(l)}
                className="accent-foreground"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-mono">{l.display_name}</span>
                <span className="text-[10px] font-mono text-muted-foreground capitalize">{l.sport}</span>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
