"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  showId: string;
  name: string;
  imageUrl: string | null;
  initialFavorited: boolean;
  signedIn: boolean;
  className?: string;
};

/** Compact star toggle for a podcast tile/row — mirrors FavoriteTeamButton's
 *  error-checked toggle so a failed write can't optimistically lie. */
export function FavoritePodcastButton({ showId, name, imageUrl, initialFavorited, signedIn, className }: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);

  if (!signedIn) return null;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (favorited) {
        const { error } = await supabase.from("watchlist_podcasts").delete().eq("show_id", showId);
        if (!error) setFavorited(false);
      } else {
        const { error } = await supabase
          .from("watchlist_podcasts")
          .insert({ user_id: user.id, show_id: showId, name, image_url: imageUrl });
        if (!error) setFavorited(true);
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
      className={`text-sm leading-none disabled:opacity-50 ${className ?? ""}`}
      style={{ color: favorited ? "hsl(45 90% 52%)" : "hsl(var(--muted-foreground))" }}
    >
      {favorited ? "★" : "☆"}
    </button>
  );
}
