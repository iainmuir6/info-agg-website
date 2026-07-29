"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  stockId: string;
  ticker: string;
  initialFavorited: boolean;
  /** Signed-out visitors see nothing (favoriting requires an account) */
  signedIn: boolean;
};

/** Star toggle for a stock detail page — mirrors FavoriteTeamButton's
 *  error-checked toggle so a failed write can't optimistically lie. */
export function FavoriteStockButton({ stockId, ticker, initialFavorited, signedIn }: Props) {
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
          .from("watchlist_stocks")
          .delete()
          .eq("stock_id", stockId);
        if (deleteError) setError(deleteError.message);
        else setFavorited(false);
      } else {
        const { error: insertError } = await supabase
          .from("watchlist_stocks")
          .insert({ user_id: user.id, stock_id: stockId });
        if (insertError) setError(insertError.message);
        else setFavorited(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={toggle}
        disabled={busy}
        title={favorited ? `Remove ${ticker} from favorites` : `Add ${ticker} to favorites`}
        className="text-[10px] font-mono tracking-wider uppercase border border-border px-2 py-0.5 hover:border-foreground transition-colors disabled:opacity-50"
        style={favorited ? { color: "hsl(45 90% 52%)", borderColor: "hsl(45 90% 52%)" } : undefined}
      >
        {favorited ? "★ Favorited" : "☆ Favorite"}
      </button>
      {error && <p className="text-[9px] font-mono text-red-500">{error}</p>}
    </div>
  );
}
