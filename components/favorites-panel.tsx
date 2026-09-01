"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { leagueLabel } from "@/lib/leagues";

export type FavoriteStock = {
  stock_id: string;
  ticker: string;
  name: string;
  current_price: number | null;
  percent_change: number | null;
};

export type FavoriteTeamRow = {
  id: string;
  team_name: string;
  league: string;
  league_label: string;
};

export type FavoritePodcastRow = {
  id: string;
  show_id: string;
  name: string;
  image_url: string | null;
};

type PodcastResult = {
  showId: string;
  name: string;
  publisher: string | null;
  imageUrl: string | null;
};

type TeamResult = {
  leagueId: string;
  league: string;
  teamName: string;
  logo: string | null;
};

type AddMode = "stock" | "team" | "podcast";

/** Row-side accent is the only thing distinguishing the three kinds of
 *  favorite — they share one panel, so a per-kind header would just be three
 *  panels again with extra steps. */
const ACCENT = {
  stock: "hsl(142 65% 42%)",
  team: "hsl(25 95% 50%)",
  podcast: "hsl(340 78% 50%)",
} as const;

function Row({
  accent,
  children,
  onRemove,
  removeLabel,
}: {
  accent: string;
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary/50 transition-colors"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">{children}</div>
      <button
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="shrink-0 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
      >
        ×
      </button>
    </div>
  );
}

/**
 * One panel for every kind of favorite — stocks, teams and podcasts — replacing
 * the three separate watchlist cards the profile page used to stack.
 *
 * All three are searchable here. Teams come from `sports_standings`, which is
 * the closest thing to a teams table: one row per team per league per season,
 * carrying the same ESPN display name `watchlist_teams` keys on plus a logo.
 */
export function FavoritesPanel({
  initialStocks,
  initialTeams,
  initialPodcasts,
}: {
  initialStocks: FavoriteStock[];
  initialTeams: FavoriteTeamRow[];
  initialPodcasts: FavoritePodcastRow[];
}) {
  const [stocks, setStocks] = useState(initialStocks);
  const [teams, setTeams] = useState(initialTeams);
  const [podcasts, setPodcasts] = useState(initialPodcasts);

  const [mode, setMode] = useState<AddMode>("stock");
  const [query, setQuery] = useState("");
  const [stockHits, setStockHits] = useState<{ id: string; ticker: string; name: string }[]>([]);
  const [teamHits, setTeamHits] = useState<TeamResult[]>([]);
  const [podcastHits, setPodcastHits] = useState<PodcastResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetSearch() {
    setQuery("");
    setStockHits([]);
    setTeamHits([]);
    setPodcastHits([]);
  }

  async function handleSearch(value: string) {
    setQuery(value);
    setError(null);
    if (mode === "stock") {
      if (value.length < 1) return setStockHits([]);
      const supabase = createClient();
      const { data } = await supabase
        .from("stocks")
        .select("id, ticker, name")
        .ilike("ticker", `${value}%`)
        .eq("is_active", true)
        .limit(6);
      setStockHits(data ?? []);
      return;
    }
    if (mode === "team") {
      if (value.trim().length < 2) return setTeamHits([]);
      setSearching(true);
      try {
        const supabase = createClient();
        // Over-fetch and dedupe client-side: a team has one standings row per
        // season, and PostgREST has no DISTINCT ON.
        const { data } = await supabase
          .from("sports_standings")
          .select("team_name, logo, league_id, season, leagues(league)")
          .ilike("team_name", `%${value.trim()}%`)
          .order("season", { ascending: false })
          .limit(40);
        const seen = new Set<string>();
        const hits: TeamResult[] = [];
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        for (const row of (data ?? []) as any[]) {
          const key = `${row.league_id}:${row.team_name}`;
          // No league slug means no team page to link the favorite to, so the
          // row would be unusable once added.
          if (!row.team_name || !row.leagues?.league || seen.has(key)) continue;
          seen.add(key);
          hits.push({
            leagueId: row.league_id,
            league: row.leagues.league,
            teamName: row.team_name,
            logo: row.logo ?? null,
          });
          if (hits.length === 8) break;
        }
        setTeamHits(hits);
      } catch {
        setTeamHits([]);
      } finally {
        setSearching(false);
      }
      return;
    }
    if (value.trim().length < 2) return setPodcastHits([]);
    setSearching(true);
    try {
      const res = await fetch(`/api/podcasts/search?q=${encodeURIComponent(value)}`);
      const data = await res.json();
      setPodcastHits(res.ok ? (data.results ?? []) : []);
    } catch {
      setPodcastHits([]);
    } finally {
      setSearching(false);
    }
  }

  async function addStock(hit: { id: string; ticker: string; name: string }) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertError } = await supabase
      .from("watchlist_stocks")
      .insert({ stock_id: hit.id, user_id: user?.id });
    if (insertError) {
      setError(insertError.message);
    } else {
      setStocks((prev) => [
        ...prev,
        { stock_id: hit.id, ticker: hit.ticker, name: hit.name, current_price: null, percent_change: null },
      ]);
      resetSearch();
    }
    setBusy(false);
  }

  async function addTeam(hit: TeamResult) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inserted, error: insertError } = await supabase
      .from("watchlist_teams")
      .insert({ user_id: user?.id, league_id: hit.leagueId, team_name: hit.teamName })
      .select("id")
      .single();
    if (insertError) {
      // 23505 = the (user_id, league_id, team_name) unique constraint: the team
      // is already favorited, most likely starred from its own team page.
      setError(
        insertError.code === "23505"
          ? `${hit.teamName} is already in your favorites.`
          : insertError.message,
      );
    } else if (inserted) {
      setTeams((prev) => [
        ...prev,
        {
          id: inserted.id as string,
          team_name: hit.teamName,
          league: hit.league,
          league_label: leagueLabel(hit.league),
        },
      ]);
      resetSearch();
    }
    setBusy(false);
  }

  async function addPodcast(hit: PodcastResult) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inserted, error: insertError } = await supabase
      .from("watchlist_podcasts")
      .insert({ user_id: user?.id, show_id: hit.showId, name: hit.name, image_url: hit.imageUrl })
      .select("id, show_id, name, image_url")
      .single();
    if (insertError) {
      setError(insertError.message);
    } else if (inserted) {
      setPodcasts((prev) => [...prev, inserted as FavoritePodcastRow]);
      resetSearch();
    }
    setBusy(false);
  }

  async function removeStock(stockId: string) {
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.from("watchlist_stocks").delete().eq("stock_id", stockId);
    if (e) return setError(e.message);
    setStocks((prev) => prev.filter((s) => s.stock_id !== stockId));
  }

  async function removeTeam(id: string) {
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.from("watchlist_teams").delete().eq("id", id);
    if (e) return setError(e.message);
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }

  async function removePodcast(id: string) {
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.from("watchlist_podcasts").delete().eq("id", id);
    if (e) return setError(e.message);
    setPodcasts((prev) => prev.filter((p) => p.id !== id));
  }

  const total = stocks.length + teams.length + podcasts.length;
  const addedShowIds = new Set(podcasts.map((p) => p.show_id));
  const addedStockIds = new Set(stocks.map((s) => s.stock_id));
  const addedTeamKeys = new Set(teams.map((t) => `${t.league}:${t.team_name}`));

  return (
    <div className="border border-border">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">Favorites</span>
        <div className="flex items-center gap-2.5">
          {([
            ["stock", stocks.length, "Stocks"],
            ["team", teams.length, "Teams"],
            ["podcast", podcasts.length, "Podcasts"],
          ] as const).map(([kind, count, label]) => (
            <span key={kind} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
              <span className="w-1.5 h-1.5 shrink-0" style={{ backgroundColor: ACCENT[kind] }} />
              {count} {label}
            </span>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">
          Nothing favorited yet — search for a stock, team or podcast below.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {stocks.map((s) => (
            <Row
              key={`stock-${s.stock_id}`}
              accent={ACCENT.stock}
              onRemove={() => removeStock(s.stock_id)}
              removeLabel={`Remove ${s.ticker} from favorites`}
            >
              <Link href={`/markets/${s.ticker}`} className="flex items-center gap-2 min-w-0 flex-1 hover:underline">
                <span className="text-[11px] font-mono font-bold shrink-0">{s.ticker}</span>
                <span className="text-[10px] font-mono text-muted-foreground truncate">{s.name}</span>
              </Link>
              {s.current_price != null && (
                <span className="text-[11px] font-mono tabular-nums shrink-0">${s.current_price.toFixed(2)}</span>
              )}
              {s.percent_change != null && (
                <span
                  className="text-[10px] font-mono tabular-nums shrink-0"
                  style={{ color: s.percent_change >= 0 ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                >
                  {s.percent_change >= 0 ? "+" : ""}{s.percent_change.toFixed(2)}%
                </span>
              )}
            </Row>
          ))}

          {teams.map((t) => (
            <Row
              key={`team-${t.id}`}
              accent={ACCENT.team}
              onRemove={() => removeTeam(t.id)}
              removeLabel={`Remove ${t.team_name} from favorites`}
            >
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground w-10 shrink-0">
                {t.league_label}
              </span>
              <Link
                href={`/${t.league}/${encodeURIComponent(t.team_name)}`}
                className="text-[11px] font-mono truncate hover:underline"
              >
                {t.team_name}
              </Link>
            </Row>
          ))}

          {podcasts.map((p) => (
            <Row
              key={`podcast-${p.id}`}
              accent={ACCENT.podcast}
              onRemove={() => removePodcast(p.id)}
              removeLabel={`Remove ${p.name} from favorites`}
            >
              {p.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" className="w-5 h-5 shrink-0 object-cover rounded-sm" />
              )}
              <span className="text-[11px] font-mono truncate">{p.name}</span>
            </Row>
          ))}
        </div>
      )}

      {/* Add row — one search box, switched between the three kinds */}
      <div className="px-3 py-2 border-t border-border relative">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 shrink-0">
            {(["stock", "team", "podcast"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); resetSearch(); }}
                className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 transition-colors ${
                  mode === m ? "bg-foreground text-background font-bold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={
              mode === "stock" ? "Add ticker…" : mode === "team" ? "Search teams…" : "Search podcasts…"
            }
            className="flex-1 min-w-0 text-[11px] font-mono bg-transparent border border-border px-2 py-1 outline-none focus:border-foreground placeholder:text-muted-foreground"
          />
        </div>

        {searching && <p className="text-[10px] font-mono text-muted-foreground mt-1">Searching…</p>}

        {mode === "stock" && stockHits.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-10 border border-border bg-background divide-y divide-border shadow-sm max-h-64 overflow-y-auto">
            {stockHits.map((s) => {
              const added = addedStockIds.has(s.id);
              return (
                <button
                  key={s.id}
                  disabled={busy || added}
                  onClick={() => addStock(s)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <span className="text-[11px] font-mono font-bold">{s.ticker}</span>
                  <span className="text-[10px] font-mono text-muted-foreground truncate">{s.name}</span>
                  {added && <span className="text-[9px] font-mono text-muted-foreground ml-auto shrink-0">added</span>}
                </button>
              );
            })}
          </div>
        )}

        {mode === "team" && teamHits.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-10 border border-border bg-background divide-y divide-border shadow-sm max-h-64 overflow-y-auto">
            {teamHits.map((t) => {
              const added = addedTeamKeys.has(`${t.league}:${t.teamName}`);
              return (
                <button
                  key={`${t.leagueId}-${t.teamName}`}
                  disabled={busy || added}
                  onClick={() => addTeam(t)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {t.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logo} alt="" className="w-4 h-4 shrink-0 object-contain" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground w-10 shrink-0">
                    {t.league.toUpperCase()}
                  </span>
                  <span className="text-[11px] font-mono truncate">{t.teamName}</span>
                  {added && <span className="text-[9px] font-mono text-muted-foreground ml-auto shrink-0">added</span>}
                </button>
              );
            })}
          </div>
        )}

        {mode === "podcast" && podcastHits.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-10 border border-border bg-background divide-y divide-border shadow-sm max-h-64 overflow-y-auto">
            {podcastHits.map((s) => {
              const added = addedShowIds.has(s.showId);
              return (
                <button
                  key={s.showId}
                  disabled={busy || added}
                  onClick={() => addPodcast(s)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt="" className="w-6 h-6 shrink-0 object-cover rounded-sm" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-mono truncate">{s.name}</span>
                    {s.publisher && (
                      <span className="block text-[9px] font-mono text-muted-foreground truncate">{s.publisher}</span>
                    )}
                  </span>
                  {added && <span className="text-[9px] font-mono text-muted-foreground shrink-0">added</span>}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="text-[10px] font-mono text-red-500 mt-1">{error}</p>}
      </div>
    </div>
  );
}
