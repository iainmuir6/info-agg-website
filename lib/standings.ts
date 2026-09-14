// Shared standings grouping/sorting — used by the league page's full
// standings table and the homepage's top-5-per-conference expander.

export type StandingRow = {
  team_name: string | null;
  team_abbrev: string;
  logo: string | null;
  conference: string | null;
  division: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  win_percent: number | null;
  games_behind: string | null;
  streak: string | null;
  playoff_seed: number | null;
  point_differential: number | null;
  points: number | null;
  rank: number | null;
  season: number | null;
};

export type StandingsGroup = { conference: string | null; teams: StandingRow[] };

/** Best available ranking signal, in priority order: ESPN's own `rank`
 *  (soccer/NHL have no winPercent), then win_percent, then a computed
 *  win ratio as a last resort. Lower is better throughout. */
function rankKey(row: StandingRow): number {
  if (row.rank != null) return row.rank;
  if (row.win_percent != null) return -row.win_percent;
  const played = (row.wins ?? 0) + (row.losses ?? 0) + (row.ties ?? 0);
  return played > 0 ? -(row.wins ?? 0) / played : 0;
}

/** Keep only the most recent season present in the row set — the table can
 *  accumulate multiple seasons over time via its (league_id, team_abbrev,
 *  season) key. */
export function latestSeasonOnly(rows: StandingRow[]): StandingRow[] {
  if (rows.length === 0) return rows;
  const maxSeason = Math.max(...rows.map((r) => r.season ?? -Infinity));
  return rows.filter((r) => (r.season ?? -Infinity) === maxSeason);
}

/** Group by conference (encounter order) and sort each group by rank.
 *  Leagues with no conference split come back as one group keyed `null`. */
export function groupStandings(rows: StandingRow[]): StandingsGroup[] {
  const groups: StandingsGroup[] = [];
  const index = new Map<string | null, StandingsGroup>();
  for (const row of rows) {
    const key = row.conference ?? null;
    let group = index.get(key);
    if (!group) {
      group = { conference: key, teams: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.teams.push(row);
  }
  for (const group of groups) {
    group.teams.sort((a, b) => rankKey(a) - rankKey(b));
  }
  return groups;
}

/** Top N teams per conference, plus any favorited team that would otherwise
 *  be sliced out. A large league (NCAAF's ~130 FBS teams across ~10
 *  conferences) routinely has a followed team sitting well outside its
 *  conference's top N — a plain top-N cut would drop it from the homepage
 *  card regardless of the favorite, which is silently indistinguishable
 *  from favoriting not working at all. Favorited teams beyond N are appended
 *  after the top N (still in rank order among themselves). */
export function topNPerGroupWithFavorites(
  groups: StandingsGroup[],
  n: number,
  isFavorite: (row: StandingRow) => boolean,
): StandingsGroup[] {
  return groups.map((g) => {
    const top = g.teams.slice(0, n);
    const extraFavorites = g.teams.slice(n).filter(isFavorite);
    return extraFavorites.length > 0 ? { ...g, teams: [...top, ...extraFavorites] } : { ...g, teams: top };
  });
}
