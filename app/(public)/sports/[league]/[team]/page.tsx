import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";

type Score = {
  id: number;
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

/** Match URL segment to ESPN display names in DB (spacing, unicode, case). */
function normalizeTeamName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function teamNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

/** Prefer the exact string stored on a score row for display / linking. */
function canonicalTeamNameFromGames(games: Score[], teamKey: string): string | null {
  for (const g of games) {
    if (normalizeTeamName(g.home_team) === teamKey) return g.home_team;
    if (normalizeTeamName(g.away_team) === teamKey) return g.away_team;
  }
  return null;
}

/**
 * Dynamic route segments are usually decoded by Next.js, but links built with
 * encodeURIComponent can still arrive encoded in some cases — decode so matching
 * and display see real spaces (e.g. "San Antonio Spurs", not "San%20Antonio%20Spurs").
 */
function decodeUrlSegment(segment: string): string {
  let s = segment;
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(s.replace(/\+/g, " "));
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s;
}

function getStatusBadge(status: string | null) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("in") || s.includes("live") || s.includes("progress"))
    return { label: "LIVE", color: "hsl(0 72% 50%)" };
  if (s.includes("final"))
    return { label: "FINAL", color: "hsl(var(--muted-foreground))" };
  if (s.includes("pre") || s.includes("scheduled"))
    return { label: "UPCOMING", color: "hsl(220 90% 52%)" };
  return { label: status.toUpperCase(), color: "hsl(var(--muted-foreground))" };
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateShort(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ league: string; team: string }>;
}) {
  const { league: leagueParam, team: teamParam } = await params;
  const teamDecoded = decodeUrlSegment(teamParam);
  const teamKey = normalizeTeamName(teamDecoded);
  const supabase = await createClient();

  // Fetch the league row
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("id, sport, league, display_name, is_active")
    .eq("league", leagueParam.toLowerCase())
    .single();

  if (!leagueRow) notFound();

  // Fetch all games for this league, filter client-side for this team
  const [allGamesRes, newsRes] = await Promise.all([
    supabase
      .from("sports_scores")
      .select(
        "id, home_team, away_team, home_score, away_score, home_record, away_record, status, status_detail, game_date, venue, broadcast"
      )
      .eq("league_id", leagueRow.id)
      .order("game_date", { ascending: false })
      .limit(200),
    supabase
      .from("sports_news")
      .select("id, title, description, url, image_url, published_at, source")
      .eq("league_id", leagueRow.id)
      .order("published_at", { ascending: false })
      .limit(20),
  ]);

  const allGames = (allGamesRes.data ?? []) as Score[];
  const teamGames = allGames.filter(
    (g) => teamNamesMatch(g.home_team, teamKey) || teamNamesMatch(g.away_team, teamKey)
  );

  const displayTeamName = canonicalTeamNameFromGames(teamGames, teamKey) ?? teamDecoded;

  const now = new Date();

  const isCompleted = (g: Score) => {
    const s = (g.status ?? "").toLowerCase();
    if (s.includes("final") || s.includes("post")) return true;
    const dt = g.game_date ? new Date(g.game_date) : null;
    return !!dt && dt < now;
  };

  const pastGames = teamGames
    .filter(isCompleted)
    .sort(
      (a, b) =>
        new Date(b.game_date ?? "").getTime() - new Date(a.game_date ?? "").getTime()
    );

  const upcomingGames = teamGames
    .filter((g) => !isCompleted(g))
    .sort(
      (a, b) =>
        new Date(a.game_date ?? "").getTime() - new Date(b.game_date ?? "").getTime()
    );

  // Filter news that mentions the team (last word of team name, e.g. "Lakers")
  const allNews = (newsRes.data ?? []) as NewsItem[];
  const teamWord = displayTeamName.split(/\s+/).pop()?.toLowerCase() ?? "";
  const teamNews = teamWord.length > 3
    ? allNews.filter((n) => n.title.toLowerCase().includes(teamWord))
    : allNews;

  const color = SPORT_COLORS[leagueRow.sport] ?? "hsl(25 95% 50%)";

  // Win/loss record from past games
  const record = pastGames.reduce(
    (acc, g) => {
      const isHome = teamNamesMatch(g.home_team, teamKey);
      const teamScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      const status = (g.status ?? "").toLowerCase();
      if (!status.includes("final") && !status.includes("post")) return acc;
      if (teamScore == null || oppScore == null) return acc;
      if (teamScore > oppScore) acc.wins++;
      else if (teamScore < oppScore) acc.losses++;
      return acc;
    },
    { wins: 0, losses: 0 }
  );

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto space-y-6">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Link
          href="/sports"
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors tracking-wider uppercase"
        >
          ← Sports
        </Link>
        <span className="text-muted-foreground text-[10px] font-mono">/</span>
        <Link
          href="/sports"
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors tracking-wider uppercase"
        >
          {leagueRow.display_name}
        </Link>
        <span className="text-muted-foreground text-[10px] font-mono">/</span>
        <span className="text-[10px] font-mono tracking-wider uppercase">{displayTeamName}</span>
      </div>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div>
        <div className="rule-double mb-4" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-3xl font-black tracking-tight leading-none"
              style={{ fontFamily: "Georgia, serif" }}
            >
              <span style={{ color }}>◉</span> {displayTeamName}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span
                className="text-xs font-mono font-bold tracking-widest uppercase"
                style={{ color }}
              >
                {leagueRow.display_name}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground capitalize">
                {leagueRow.sport}
              </span>
            </div>
          </div>

          {/* Record */}
          {(record.wins > 0 || record.losses > 0) && (
            <div className="text-right">
              <p className="text-3xl font-mono font-black tabular-nums">
                {record.wins}–{record.losses}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground">
                W–L (tracked games)
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-px bg-border">
        {[
          { label: "Games Tracked", value: teamGames.length },
          { label: "Past Games", value: pastGames.length },
          { label: "Upcoming", value: upcomingGames.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-background px-4 py-3">
            <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-1">
              {label}
            </p>
            <p className="text-xl font-mono font-black tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {teamGames.length === 0 && teamNews.length === 0 && (
        <div className="rounded border border-border bg-secondary/30 px-4 py-5 text-center">
          <p className="text-sm font-mono text-muted-foreground">
            No matching games or articles for this team in the current league snapshot.
          </p>
        </div>
      )}

      {/* ── Upcoming Games ───────────────────────────────────────────── */}
      {upcomingGames.length > 0 && (
        <div>
          <p
            className="text-[10px] font-mono tracking-widest uppercase mb-3"
            style={{ color }}
          >
            Upcoming Games — {upcomingGames.length}
          </p>
          <div className="space-y-px bg-border">
            {upcomingGames.map((game) => {
              const badge = getStatusBadge(game.status);
              const isHome = teamNamesMatch(game.home_team, teamKey);
              const opponent = isHome ? game.away_team : game.home_team;
              const opponentLeague = leagueParam;
              return (
                <div
                  key={game.id}
                  className="bg-background px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {isHome ? "vs" : "@"}
                      </span>
                      <Link
                        href={`/sports/${opponentLeague}/${encodeURIComponent(opponent ?? "")}`}
                        className="text-sm font-mono font-bold hover:underline truncate"
                      >
                        {opponent}
                      </Link>
                    </div>
                    <div className="text-right shrink-0">
                      {badge && (
                        <span
                          className="text-[9px] font-mono tracking-wider"
                          style={{ color: badge.color }}
                        >
                          {badge.label}
                        </span>
                      )}
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {fmtDate(game.game_date)}
                      </p>
                      {game.venue && (
                        <p className="text-[9px] font-mono text-muted-foreground">
                          {game.venue}
                        </p>
                      )}
                      {game.broadcast && (
                        <p className="text-[9px] font-mono text-muted-foreground">
                          📺 {game.broadcast}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Past Games ───────────────────────────────────────────────── */}
      {pastGames.length > 0 && (
        <div>
          <p
            className="text-[10px] font-mono tracking-widest uppercase mb-3"
            style={{ color }}
          >
            Recent Results — {pastGames.length} games
          </p>
          <div className="space-y-px bg-border">
            {pastGames.map((game) => {
              const badge = getStatusBadge(game.status);
              const isHome = teamNamesMatch(game.home_team, teamKey);
              const opponent = isHome ? game.away_team : game.home_team;
              const teamScore = isHome ? game.home_score : game.away_score;
              const oppScore = isHome ? game.away_score : game.home_score;
              const status = (game.status ?? "").toLowerCase();
              const isFinalGame = status.includes("final") || status.includes("post");
              const won =
                isFinalGame && teamScore != null && oppScore != null
                  ? teamScore > oppScore
                  : null;
              const opponentLeague = leagueParam;

              return (
                <div
                  key={game.id}
                  className="bg-background px-4 py-3 flex items-center gap-4"
                >
                  {/* Result indicator */}
                  {won !== null && (
                    <div
                      className="w-1 self-stretch shrink-0"
                      style={{
                        backgroundColor: won
                          ? "hsl(142 65% 42%)"
                          : "hsl(0 72% 50%)",
                      }}
                    />
                  )}

                  <div className="flex items-center justify-between gap-4 flex-1 min-w-0">
                    {/* Opponent */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {isHome ? "vs" : "@"}
                      </span>
                      <Link
                        href={`/sports/${opponentLeague}/${encodeURIComponent(opponent ?? "")}`}
                        className="text-sm font-mono font-bold hover:underline truncate"
                      >
                        {opponent}
                      </Link>
                    </div>

                    {/* Score + meta */}
                    <div className="text-right shrink-0 flex items-center gap-4">
                      {teamScore != null && (
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-xl font-mono font-black tabular-nums"
                            style={{
                              color:
                                won === true
                                  ? "hsl(142 65% 42%)"
                                  : won === false
                                  ? "hsl(0 72% 50%)"
                                  : undefined,
                            }}
                          >
                            {teamScore}
                          </span>
                          <span className="text-muted-foreground font-mono">–</span>
                          <span className="text-xl font-mono font-black tabular-nums text-muted-foreground">
                            {oppScore}
                          </span>
                        </div>
                      )}
                      <div className="text-right">
                        {badge && (
                          <span
                            className="text-[9px] font-mono tracking-wider block"
                            style={{ color: badge.color }}
                          >
                            {badge.label}
                          </span>
                        )}
                        <span className="text-[9px] font-mono text-muted-foreground">
                          {fmtDateShort(game.game_date)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── News ─────────────────────────────────────────────────────── */}
      {teamNews.length > 0 && (
        <div>
          <p
            className="text-[10px] font-mono tracking-widest uppercase mb-3"
            style={{ color }}
          >
            {leagueRow.display_name} News — {teamNews.length} articles
          </p>
          <div className="space-y-px bg-border">
            {teamNews.map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-background flex gap-0 hover:bg-secondary transition-colors group"
              >
                {article.image_url ? (
                  <div className="w-20 h-16 shrink-0 overflow-hidden border-r border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={article.image_url}
                      alt=""
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                    />
                  </div>
                ) : (
                  <div className="w-20 h-16 shrink-0 border-r border-border flex items-center justify-center">
                    <span className="text-xs font-mono" style={{ color }}>
                      ◉
                    </span>
                  </div>
                )}
                <div className="flex-1 px-4 py-3 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {article.source}
                    </span>
                    {article.published_at && (
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        {fmtDateShort(article.published_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold leading-snug line-clamp-2 group-hover:underline">
                    {article.title}
                  </p>
                  {article.description && (
                    <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                      {article.description}
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
