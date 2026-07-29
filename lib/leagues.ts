// League slug registry — powers the top-level /nba, /wnba, /mlb … routes and
// keeps display metadata in one place. Slugs match info_agg.leagues.league.

export type LeagueMeta = {
  slug: string;      // URL + DB slug
  label: string;     // display label
  sport: string;     // DB sport
  espn: string;      // ESPN URL path segment
  accent: string;
};

export const LEAGUES: LeagueMeta[] = [
  { slug: "nfl", label: "NFL", sport: "football", espn: "nfl", accent: "hsl(25 95% 50%)" },
  { slug: "nba", label: "NBA", sport: "basketball", espn: "nba", accent: "hsl(25 80% 55%)" },
  { slug: "wnba", label: "WNBA", sport: "basketball", espn: "wnba", accent: "hsl(310 78% 50%)" },
  { slug: "mlb", label: "MLB", sport: "baseball", espn: "mlb", accent: "hsl(220 80% 55%)" },
  { slug: "nhl", label: "NHL", sport: "hockey", espn: "nhl", accent: "hsl(200 80% 50%)" },
  {
    slug: "college-football",
    label: "NCAAF",
    sport: "football",
    espn: "college-football",
    accent: "hsl(15 85% 50%)",
  },
  {
    slug: "mens-college-basketball",
    label: "NCAAB",
    sport: "basketball",
    espn: "mens-college-basketball",
    accent: "hsl(40 90% 50%)",
  },
  {
    slug: "college-baseball",
    label: "NCAA Baseball",
    sport: "baseball",
    espn: "college-baseball",
    accent: "hsl(200 70% 45%)",
  },
  { slug: "eng.1", label: "Premier League", sport: "soccer", espn: "eng.1", accent: "hsl(142 65% 42%)" },
];

export function leagueBySlug(slug: string): LeagueMeta | undefined {
  return LEAGUES.find((l) => l.slug === slug.toLowerCase());
}

/** ESPN gamecast URL for a game in this league. */
export function espnGameUrl(leagueSlug: string, eventId: string): string {
  const meta = leagueBySlug(leagueSlug);
  const path = meta?.espn ?? leagueSlug;
  return path.includes(".")
    ? `https://www.espn.com/soccer/match/_/gameId/${eventId}`
    : `https://www.espn.com/${path}/game/_/gameId/${eventId}`;
}

/** ESPN team page URL (abbreviation-based). */
export function espnTeamUrl(leagueSlug: string, abbrev: string): string {
  const meta = leagueBySlug(leagueSlug);
  const path = meta?.espn ?? leagueSlug;
  return path.includes(".")
    ? `https://www.espn.com/soccer/team/_/name/${abbrev.toLowerCase()}`
    : `https://www.espn.com/${path}/team/_/name/${abbrev.toLowerCase()}`;
}
