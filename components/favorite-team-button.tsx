"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  leagueId: string;
  teamName: string;
  initialFavorited: boolean;
  /** Signed-out visitors see nothing (favoriting requires an account) */
  signedIn: boolean;
};

export function FavoriteTeamButton({ leagueId, teamName, initialFavorited, signedIn }: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);

  if (!signedIn) return null;

  async function toggle() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (favorited) {
        await supabase
          .from("watchlist_teams")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_name", teamName);
        setFavorited(false);
      } else {
        await supabase
          .from("watchlist_teams")
          .insert({ user_id: user.id, league_id: leagueId, team_name: teamName });
        setFavorited(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      className="text-sm font-mono border border-border px-2 py-1 hover:border-foreground transition-colors disabled:opacity-50"
      style={favorited ? { color: "hsl(45 90% 52%)", borderColor: "hsl(45 90% 52%)" } : undefined}
    >
      {favorited ? "★ Favorited" : "☆ Favorite"}
    </button>
  );
}
