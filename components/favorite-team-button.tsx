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
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (favorited) {
        const { error: deleteError } = await supabase
          .from("watchlist_teams")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_name", teamName);
        if (deleteError) {
          setError(deleteError.message);
        } else {
          setFavorited(false);
        }
      } else {
        const { error: insertError } = await supabase
          .from("watchlist_teams")
          .insert({ user_id: user.id, league_id: leagueId, team_name: teamName });
        if (insertError) {
          setError(insertError.message);
        } else {
          setFavorited(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        title={favorited ? "Remove from favorites" : "Add to favorites"}
        className="text-sm font-mono border border-border px-2 py-1 hover:border-foreground transition-colors disabled:opacity-50"
        style={favorited ? { color: "hsl(45 90% 52%)", borderColor: "hsl(45 90% 52%)" } : undefined}
      >
        {favorited ? "★ Favorited" : "☆ Favorite"}
      </button>
      {error && <p className="text-[10px] font-mono text-red-500">{error}</p>}
    </div>
  );
}
