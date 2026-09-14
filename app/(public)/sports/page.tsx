import { createClient } from "@/lib/supabase/server";
import { getFavorites, gameIsFavorite, byDayThenFavorites, teamKey } from "@/lib/favorites";
import { leadingDaySlate, easternDay, formatDayKey } from "@/lib/sports-status";
import { FavoriteStar } from "@/components/favorite-star";
import Link from "next/link";
import { teamNickname } from "@/lib/sports-status";
import { espnGameUrl } from "@/lib/leagues";
import { APP_TIME_ZONE, formatWeekdayDateTime, formatDate as formatDateShort } from "@/lib/format-date";

type League = { id: number; sport: string; league: string; display_name: string };
type Score = {
  id: number;
  league_id: number;
  home_team: string;
  away_team: string;
  home_abbrev: string | null;
  away_abbrev: string | null;
  home_logo: string | null;
  away_logo: string | null;
  event_id: string | null;
  home_score: number | null;
  away_score: number | null;
  home_record: string | null;
  away_record: string | null;
  status: string | null;
  status_detail: string | null;
  game_date: string | null;
  venue: string | null;
  broadcast: string | null;
};
type NewsItem = {
  id: number;
  league_id: number;
  title: string;
  description: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  source: string;
};

const SPORT_COLORS: Record<string, string> = {
  football: "hsl(25 95% 50%)",
  basketball: "hsl(25 80% 55%)",
  baseball: "hsl(220 80% 55%)",
  hockey: "hsl(200 80% 50%)",
  soccer: "hsl(142 65% 42%)",
};

function getStatusBadge(status: string | null) {
  if (!status) return null;
  const s = status.toLowerCase();
  // Order matters, and the live test must NOT be a bare `includes("in")` —
  // "final" contains "in", so every finished game was badged LIVE. Final is
  // also checked first so a status like "Final/OT" can't fall through.
  if (s.includes("final")) {
    return { label: "FINAL", color: "hsl(var(--muted-foreground))" };
  }
  if (s.includes("progress") || s.includes("live")) {
    return { label: "LIVE", color: "hsl(0 72% 50%)" };
  }
  if (s.includes("pre") || s.includes("scheduled")) {
    return { label: "UPCOMING", color: "hsl(220 90% 52%)" };
  }
  return { label: status.toUpperCase(), color: "hsl(var(--muted-foreground))" };
}

function formatDate(dateStr: string | null) {
  return formatWeekdayDateTime(dateStr);
}

async function getSportsData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [leaguesRes, scoresRes, newsRes] = await Promise.all([
    supabase
      .from("leagues")
      .select("id, sport, league, display_name")
      .eq("is_active", true)
      .order("sport"),
    // Window around today. Ordering by game_date desc without a window
    // returns only far-future fixtures (e.g. college football in August),
    // which the in-season filter then rejects — leaving the page blank.
    supabase
      .from("sports_scores")
      .select("id, league_id, home_team, away_team, home_abbrev, away_abbrev, home_logo, away_logo, event_id, home_score, away_score, home_record, away_record, status, status_detail, game_date, venue, broadcast")
      .gte("game_date", new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString())
      .lte("game_date", new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString())
      .order("game_date", { ascending: false })
      .limit(400),
    supabase
      .from("sports_news")
      .select("id, league_id, title, description, url, image_url, published_at, source")
      .order("published_at", { ascending: false })
      .limit(50),
  ]);

  return {
    leagues: (leaguesRes.data ?? []) as League[],
    scores: (scoresRes.data ?? []) as Score[],
    news: (newsRes.data ?? []) as NewsItem[],
  };
}

export default async function SportsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const [{ leagues, scores, news }, favorites] = await Promise.all([
    getSportsData(supabase),
    getFavorites(supabase, claimsData?.claims?.sub as string | undefined),
  ]);

  // Group scores and news by league
  const scoresByLeague = scores.reduce<Record<number, Score[]>>((acc, s) => {
    if (!acc[s.league_id]) acc[s.league_id] = [];
    acc[s.league_id].push(s);
    return acc;
  }, {});

  const newsByLeague = news.reduce<Record<number, NewsItem[]>>((acc, n) => {
    if (!acc[n.league_id]) acc[n.league_id] = [];
    acc[n.league_id].push(n);
    return acc;
  }, {});

  const hasData = leagues.length > 0 && (scores.length > 0 || news.length > 0);

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Page header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            <span style={{ color: "hsl(25 95% 50%)" }}>◉</span> SPORTS
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            {scores.length} games · {news.length} articles
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          ESPN · {leagues.length} LEAGUES TRACKED
        </p>
      </div>

      {!hasData ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">
            NO SPORTS DATA YET
          </p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <div className="space-y-px bg-border">
          {leagues.map((league) => {
            const leagueScores = scoresByLeague[league.id] ?? [];
            const leagueNews = newsByLeague[league.id] ?? [];
            if (leagueScores.length === 0 && leagueNews.length === 0) return null;

            // In-season gate: hide leagues whose games all fall outside the
            // last/next 10 days (same rule as the Command Center cards).
            const IN_SEASON_WINDOW_MS = 10 * 24 * 3600 * 1000;
            // Server Component: renders once per request and must read the wall clock.
            // The purity rule targets client components the compiler may memoise;
            // there is no pure way to ask "what time is it now" on the server.
            // eslint-disable-next-line react-hooks/purity
            const nowMs = Date.now();
            const inSeason = leagueScores.some((s) => {
              const t = s.game_date ? new Date(s.game_date).getTime() : NaN;
              return Number.isFinite(t) && Math.abs(nowMs - t) <= IN_SEASON_WINDOW_MS;
            });
            if (!inSeason) return null;

            const color = SPORT_COLORS[league.sport] ?? "hsl(25 95% 50%)";

            // Same split as the league pages: a game whose start time has
            // passed but that is still reported Scheduled is not a result.
            const isPlayed = (s: Score) => {
              const st = (s.status ?? "").toLowerCase();
              return st.includes("final") || st.includes("progress") || st.includes("live");
            };
            // Day is the primary sort; favorites only break ties within the
            // same day. Sorting on the full timestamp instead left no ties for
            // the favorite check to break, so favorites never surfaced.
            const isFavTeam = (name: string) => favorites.teams.has(teamKey(league.league, name));
            const isFavGame = (s: Score) => gameIsFavorite(favorites, league.league, s);
            // One day's full slate per column, not an arbitrary count — MLB
            // plays 16 games a day, so `slice(0, 6)` showed less than half of
            // one day while also mixing in older days.
            const played = byDayThenFavorites(
              leadingDaySlate(leagueScores.filter(isPlayed), (s) => s.game_date, "desc", isFavGame),
              (s) => s.game_date,
              isFavGame,
              "desc",
            );
            // Today-onward only. The ±10-day window also contains games ESPN
            // still reports as Scheduled days after the fact (postponements, or
            // rows we never refreshed). Taking the earliest unplayed day made
            // the Schedule column show a stale slate from over a week ago.
            const todayKey = easternDay(new Date().toISOString());
            const notYetPlayed = leagueScores.filter((s) => !isPlayed(s));
            const upcomingOnly = notYetPlayed.filter((s) => easternDay(s.game_date) >= todayKey);
            const scheduled = byDayThenFavorites(
              leadingDaySlate(upcomingOnly, (s) => s.game_date, "asc", isFavGame),
              (s) => s.game_date,
              isFavGame,
              "asc",
            );
            const playedDay = formatDayKey(easternDay(played[0]?.game_date));
            const scheduledDay = formatDayKey(easternDay(scheduled[0]?.game_date));

            return (
              <section key={league.id} className="bg-background">
                {/* League header */}
                <div
                  className="flex items-center gap-3 px-5 py-3 border-b border-border"
                  style={{ borderLeftWidth: "3px", borderLeftColor: color }}
                >
                  <Link
                    href={`/${league.league}`}
                    className="text-xs font-mono font-bold tracking-widest uppercase hover:underline"
                    style={{ color }}
                  >
                    {league.display_name}
                  </Link>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {leagueScores.length} games · {leagueNews.length} articles
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border">
                  {/* Scores column */}
                  {played.length > 0 && (
                    <div className="bg-background p-4">
                      <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                        Scores
                        <span className="normal-case tracking-normal text-muted-foreground/70">
                          {playedDay ? ` · ${playedDay} · ${played.length} games` : ` · ${played.length} games`}
                        </span>
                      </p>
                      <div className="space-y-2">
                        {played.map((game) => {
                          const badge = getStatusBadge(game.status);
                          return (
                            <div
                              key={game.id}
                              className="py-2 border-b border-border last:border-0"
                            >
                              <div className="flex items-center justify-between text-xs font-mono">
                                {/* Away */}
                                <div className="flex items-center gap-2 w-5/12">
                                  <Link
                                    href={`/${league.league}/${(game.away_abbrev ?? game.away_team).toUpperCase()}`}
                                    className="flex items-center gap-1.5 min-w-0 text-muted-foreground truncate hover:text-foreground hover:underline"
                                  >
                                    {game.away_logo && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={game.away_logo} alt="" className="w-4 h-4 shrink-0 object-contain" />
                                    )}
                                    <span className="sm:hidden truncate">{teamNickname(game.away_team)}</span>
                                    <span className="hidden sm:inline truncate">{game.away_team}</span>
                                    <FavoriteStar show={isFavTeam(game.away_team)} />
                                  </Link>
                                </div>
                                {/* Scores */}
                                {game.event_id ? (
                                  <a
                                    href={espnGameUrl(league.league, game.event_id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open game on ESPN"
                                    className="flex items-center gap-2 justify-center hover:underline"
                                  >
                                    <span className="font-bold text-sm tabular-nums">
                                      {game.away_score ?? "—"}
                                    </span>
                                    <span className="text-muted-foreground text-[10px]">–</span>
                                    <span className="font-bold text-sm tabular-nums">
                                      {game.home_score ?? "—"}
                                    </span>
                                  </a>
                                ) : (
                                  <div className="flex items-center gap-2 justify-center">
                                    <span className="font-bold text-sm tabular-nums">
                                      {game.away_score ?? "—"}
                                    </span>
                                    <span className="text-muted-foreground text-[10px]">–</span>
                                    <span className="font-bold text-sm tabular-nums">
                                      {game.home_score ?? "—"}
                                    </span>
                                  </div>
                                )}
                                {/* Home */}
                                <div className="flex items-center gap-2 w-5/12 justify-end">
                                  <Link
                                    href={`/${league.league}/${(game.home_abbrev ?? game.home_team).toUpperCase()}`}
                                    className="flex items-center gap-1.5 min-w-0 text-muted-foreground truncate hover:text-foreground hover:underline"
                                  >
                                    <span className="sm:hidden truncate">{teamNickname(game.home_team)}</span>
                                    <span className="hidden sm:inline truncate">{game.home_team}</span>
                                    <FavoriteStar show={isFavTeam(game.home_team)} />
                                    {game.home_logo && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={game.home_logo} alt="" className="w-4 h-4 shrink-0 object-contain" />
                                    )}
                                  </Link>
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                {badge && (
                                  <span
                                    className="text-[9px] font-mono tracking-wider"
                                    style={{ color: badge.color }}
                                  >
                                    {badge.label}
                                  </span>
                                )}
                                <span className="text-[9px] font-mono text-muted-foreground ml-auto">
                                  {formatDate(game.game_date)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Schedule column — upcoming and not-yet-played games */}
                  {scheduled.length > 0 && (
                    <div className="bg-background p-4">
                      <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                        Schedule
                        <span className="normal-case tracking-normal text-muted-foreground/70">
                          {scheduledDay ? ` · ${scheduledDay} · ${scheduled.length} games` : ` · ${scheduled.length} games`}
                        </span>
                      </p>
                      <div className="space-y-2">
                        {scheduled.map((game) => (
                          <div key={game.id} className="py-2 border-b border-border last:border-0">
                            <div className="flex items-center justify-between text-xs font-mono gap-2">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Link
                                  href={`/${league.league}/${(game.away_abbrev ?? game.away_team).toUpperCase()}`}
                                  className="flex items-center gap-1 min-w-0 text-muted-foreground truncate hover:text-foreground hover:underline"
                                >
                                  {game.away_logo && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={game.away_logo} alt="" className="w-4 h-4 shrink-0 object-contain" />
                                  )}
                                  <span className="sm:hidden truncate">{teamNickname(game.away_team)}</span>
                                  <span className="hidden sm:inline truncate">{game.away_team}</span>
                                  <FavoriteStar show={isFavTeam(game.away_team)} />
                                </Link>
                                <span className="text-muted-foreground/50 shrink-0">@</span>
                                <Link
                                  href={`/${league.league}/${(game.home_abbrev ?? game.home_team).toUpperCase()}`}
                                  className="flex items-center gap-1 min-w-0 text-muted-foreground truncate hover:text-foreground hover:underline"
                                >
                                  <span className="sm:hidden truncate">{teamNickname(game.home_team)}</span>
                                  <span className="hidden sm:inline truncate">{game.home_team}</span>
                                  <FavoriteStar show={isFavTeam(game.home_team)} />
                                  {game.home_logo && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={game.home_logo} alt="" className="w-4 h-4 shrink-0 object-contain" />
                                  )}
                                </Link>
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                                {game.game_date
                                  ? new Date(game.game_date).toLocaleString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                      timeZone: APP_TIME_ZONE,
                                    })
                                  : ""}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* News column */}
                  {leagueNews.length > 0 && (
                    <div className="bg-background p-4">
                      <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                        News
                      </p>
                      <div className="space-y-3">
                        {leagueNews.slice(0, 5).map((article) => (
                          <a
                            key={article.id}
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex gap-3 group hover:bg-secondary -mx-2 px-2 py-1.5 transition-colors"
                          >
                            {article.image_url && (
                              <div className="w-14 h-10 shrink-0 overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={article.image_url}
                                  alt=""
                                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                                />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:underline">
                                {article.title}
                              </p>
                              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                                {formatDateShort(article.published_at)}
                              </p>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
