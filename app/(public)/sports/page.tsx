import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type League = { id: number; sport: string; league: string; display_name: string };
type Score = {
  id: number;
  league_id: number;
  home_team: string;
  away_team: string;
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
  if (s.includes("in") || s.includes("live") || s.includes("progress")) {
    return { label: "LIVE", color: "hsl(0 72% 50%)" };
  }
  if (s.includes("final")) {
    return { label: "FINAL", color: "hsl(var(--muted-foreground))" };
  }
  if (s.includes("pre") || s.includes("scheduled")) {
    return { label: "UPCOMING", color: "hsl(220 90% 52%)" };
  }
  return { label: status.toUpperCase(), color: "hsl(var(--muted-foreground))" };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function getSportsData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [leaguesRes, scoresRes, newsRes] = await Promise.all([
    supabase
      .from("leagues")
      .select("id, sport, league, display_name")
      .eq("is_active", true)
      .order("sport"),
    supabase
      .from("sports_scores")
      .select("id, league_id, home_team, away_team, home_score, away_score, home_record, away_record, status, status_detail, game_date, venue, broadcast")
      .order("game_date", { ascending: false })
      .limit(100),
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
  const { leagues, scores, news } = await getSportsData(supabase);

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
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
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
            const nowMs = Date.now();
            const inSeason = leagueScores.some((s) => {
              const t = s.game_date ? new Date(s.game_date).getTime() : NaN;
              return Number.isFinite(t) && Math.abs(nowMs - t) <= IN_SEASON_WINDOW_MS;
            });
            if (!inSeason) return null;

            const color = SPORT_COLORS[league.sport] ?? "hsl(25 95% 50%)";

            return (
              <section key={league.id} className="bg-background">
                {/* League header */}
                <div
                  className="flex items-center gap-3 px-5 py-3 border-b border-border"
                  style={{ borderLeftWidth: "3px", borderLeftColor: color }}
                >
                  <span
                    className="text-xs font-mono font-bold tracking-widest uppercase"
                    style={{ color }}
                  >
                    {league.display_name}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {leagueScores.length} games · {leagueNews.length} articles
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
                  {/* Scores column */}
                  {leagueScores.length > 0 && (
                    <div className="bg-background p-4">
                      <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                        Scores
                      </p>
                      <div className="space-y-2">
                        {leagueScores.slice(0, 6).map((game) => {
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
                                    href={`/sports/${league.league}/${encodeURIComponent(game.away_team)}`}
                                    className="text-muted-foreground truncate hover:text-foreground hover:underline"
                                  >
                                    {game.away_team}
                                  </Link>
                                </div>
                                {/* Scores */}
                                <div className="flex items-center gap-2 justify-center">
                                  <span className="font-bold text-sm tabular-nums">
                                    {game.away_score ?? "—"}
                                  </span>
                                  <span className="text-muted-foreground text-[10px]">–</span>
                                  <span className="font-bold text-sm tabular-nums">
                                    {game.home_score ?? "—"}
                                  </span>
                                </div>
                                {/* Home */}
                                <div className="flex items-center gap-2 w-5/12 justify-end">
                                  <Link
                                    href={`/sports/${league.league}/${encodeURIComponent(game.home_team)}`}
                                    className="text-muted-foreground truncate hover:text-foreground hover:underline"
                                  >
                                    {game.home_team}
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
                                {article.published_at
                                  ? new Date(article.published_at).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })
                                  : ""}
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
