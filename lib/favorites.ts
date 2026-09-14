import type { createClient } from "@/lib/supabase/server";
import { easternDay } from "@/lib/sports-status";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type Favorites = {
  /** `${leagueSlug}|${team_name}`, lowercased — see `teamKey` */
  teams: Set<string>;
  /** Uppercase tickers */
  tickers: Set<string>;
};

export const NO_FAVORITES: Favorites = { teams: new Set(), tickers: new Set() };

/** Favorites are stored per (league, full team name) — abbreviations collide
 *  across leagues (LA, NY, SD…), full names alone don't. Score rows carry the
 *  same full names, so this is the join key everywhere. */
export function teamKey(league: string, teamName: string): string {
  return `${league.toLowerCase()}|${teamName.trim().toLowerCase()}`;
}

/** Reads a signed-in user's favorite teams + tickers in one round trip.
 *  Returns empty sets for signed-out visitors so callers never branch. */
export async function getFavorites(
  supabase: ServerClient,
  userId: string | null | undefined,
): Promise<Favorites> {
  if (!userId) return NO_FAVORITES;

  const [teamsRes, stocksRes] = await Promise.all([
    supabase.from("watchlist_teams").select("team_name, leagues(league)").eq("user_id", userId),
    supabase.from("watchlist_stocks").select("stocks(ticker)").eq("user_id", userId),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const teams = new Set(
    (teamsRes.data ?? [])
      .map((r: any) => (r.leagues?.league ? teamKey(r.leagues.league, r.team_name) : null))
      .filter((k: string | null): k is string => !!k),
  );
  const tickers = new Set(
    (stocksRes.data ?? [])
      .map((r: any) => (r.stocks?.ticker ?? "").toUpperCase())
      .filter((t: string) => t.length > 0),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { teams, tickers };
}

/** True when either side of a game is a favorite. */
export function gameIsFavorite(
  favorites: Favorites,
  league: string,
  game: { home_team?: string | null; away_team?: string | null },
): boolean {
  if (favorites.teams.size === 0) return false;
  return (
    (!!game.home_team && favorites.teams.has(teamKey(league, game.home_team))) ||
    (!!game.away_team && favorites.teams.has(teamKey(league, game.away_team)))
  );
}

/** True when a single team name is a favorite (standings rows, unlike games,
 *  carry only one team). */
export function teamIsFavorite(
  favorites: Favorites,
  league: string,
  teamName?: string | null,
): boolean {
  if (favorites.teams.size === 0 || !teamName) return false;
  return favorites.teams.has(teamKey(league, teamName));
}

/** Lowercased, unprefixed team names favorited within one league — for
 *  handing to a Client Component, which can only receive data, not the
 *  `teamIsFavorite` closure itself. */
export function favoriteTeamNamesForLeague(favorites: Favorites, league: string): Set<string> {
  const prefix = `${league.toLowerCase()}|`;
  const names = new Set<string>();
  for (const key of favorites.teams) {
    if (key.startsWith(prefix)) names.add(key.slice(prefix.length));
  }
  return names;
}

/**
 * Stable favourites-first reordering: favorites keep their relative order and
 * so does everything else, so whatever the caller already sorted by (status,
 * game time, market cap) still holds *within* each band.
 *
 * Only use this on lists with no meaningful chronology (a ticker table, a team
 * directory). For games use `byDayThenFavorites`.
 */
export function favoritesFirst<T>(items: T[], isFavorite: (item: T) => boolean): T[] {
  const fav: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isFavorite(item) ? fav : rest).push(item);
  return [...fav, ...rest];
}

/**
 * Game ordering: calendar DAY first, favorites second, clock time third.
 *
 * Sorting on the full timestamp makes favorites unreachable as a tiebreaker —
 * no two games share an exact kickoff, so the time alone fully determines the
 * order and a favorite can never rise. Comparing only the day leaves real ties
 * for the favorite check to break, so a followed team leads its own day without
 * ever jumping ahead of a more recent one. Time ordering within a day survives
 * because Array#sort is stable and callers pass time-sorted input.
 *
 * `direction` is the day direction: "desc" for results (newest day first),
 * "asc" for schedules (soonest day first). Undated games sort last either way.
 */
export function byDayThenFavorites<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  isFavorite: (item: T) => boolean,
  direction: "desc" | "asc" = "desc",
): T[] {
  const dir = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const da = easternDay(getDate(a));
    const db = easternDay(getDate(b));
    if (!da !== !db) return da ? -1 : 1;
    if (da !== db) return (da < db ? -1 : 1) * dir;
    const fa = isFavorite(a);
    const fb = isFavorite(b);
    if (fa !== fb) return fa ? -1 : 1;
    return 0;
  });
}
