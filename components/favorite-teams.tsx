"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type FavoriteTeam = {
  id: string;
  team_name: string;
  league: string; // league slug for the team-page link
  league_label: string;
};

/** Profile-page list of favorited teams. Teams are added from their team
 *  pages (star button); removed here. */
export function FavoriteTeams({ initialTeams }: { initialTeams: FavoriteTeam[] }) {
  const [teams, setTeams] = useState<FavoriteTeam[]>(initialTeams);

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("watchlist_teams").delete().eq("id", id);
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }

  if (teams.length === 0) {
    return (
      <p className="px-4 py-3 text-[11px] font-mono text-muted-foreground">
        No favorite teams yet — open a team page from any score and hit ☆.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {teams.map((t) => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground w-12 shrink-0">
            {t.league_label}
          </span>
          <Link
            href={`/sports/${t.league}/${encodeURIComponent(t.team_name)}`}
            className="text-xs font-mono flex-1 hover:underline"
          >
            {t.team_name}
          </Link>
          <button
            onClick={() => remove(t.id)}
            aria-label={`Remove ${t.team_name} from favorites`}
            className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
