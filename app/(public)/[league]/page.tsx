import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFavorites, gameIsFavorite, favoritesFirst, byDayThenFavorites, teamKey } from "@/lib/favorites";
import { FavoriteStar } from "@/components/favorite-star";
import { LEAGUES, leagueBySlug, espnGameUrl } from "@/lib/leagues";
import { compactStatus, formatGameTime } from "@/lib/sports-status";
import { latestSeasonOnly, groupStandings, type StandingRow } from "@/lib/standings";
import { formatDate } from "@/lib/format-date";

// Top-level league routes: /nba, /wnba, /mlb … Static routes (/news, /markets,
// /economy …) take precedence over this dynamic segment; anything not in the
// league registry 404s.
export function generateStaticParams() {
  return LEAGUES.map((l) => ({ league: l.slug }));
}

type Score = {
  id: string;
  event_id: string | null;
  home_team: string;
  away_team: string;
  home_abbrev: string | null;
  away_abbrev: string | null;
  home_logo: string | null;
  away_logo: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  status_detail: string | null;
  game_date: string | null;
  venue: string | null;
  broadcast: string | null;
};

function gameState(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (s.includes("final")) return "final" as const;
  if (s.includes("progress") || s.includes("live")) return "live" as const;
  return "scheduled" as const;
}

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league: leagueParam } = await params;
  const meta = leagueBySlug(leagueParam);
  if (!meta) notFound();

  const supabase = await createClient();

  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("id, sport, league, display_name")
    .eq("league", meta.slug)
    .maybeSingle();

  if (!leagueRow) notFound();

  const SCORE_COLS =
    "id, event_id, home_team, away_team, home_abbrev, away_abbrev, home_logo, away_logo, home_score, away_score, status, status_detail, game_date, venue, broadcast";
  const nowIso = new Date().toISOString();

  // Played and upcoming are fetched separately and anchored on now(). A single
  // "latest 120 by game_date" returns only far-future fixtures once a full
  // season schedule is loaded, which starved the played side entirely.
  const STANDING_COLS =
    "team_name, team_abbrev, logo, conference, division, wins, losses, ties, win_percent, games_behind, streak, playoff_seed, point_differential, points, rank, season";

  const [playedRes, upcomingRes, newsRes, standingsRes] = await Promise.all([
    supabase
      .from("sports_scores")
      .select(SCORE_COLS)
      .eq("league_id", leagueRow.id)
      .lte("game_date", nowIso)
      .order("game_date", { ascending: false })
      .limit(24),
    supabase
      .from("sports_scores")
      .select(SCORE_COLS)
      .eq("league_id", leagueRow.id)
      .gt("game_date", nowIso)
      .order("game_date", { ascending: true })
      .limit(24),
    supabase
      .from("sports_news")
      .select("id, title, description, url, image_url, published_at")
      .eq("league_id", leagueRow.id)
      .order("published_at", { ascending: false })
      .limit(20),
    supabase
      .from("sports_standings")
      .select(STANDING_COLS)
      .eq("league_id", leagueRow.id),
  ]);

  const played = (playedRes.data ?? []) as Score[];
  const upcoming = (upcomingRes.data ?? []) as Score[];
  const news = newsRes.data ?? [];
  const scores = [...played, ...upcoming];
  const standingsGroups = groupStandings(latestSeasonOnly((standingsRes.data ?? []) as StandingRow[]));

  // Scores = games that have actually been played or are in progress.
  // A game whose start time has passed but that ESPN still reports as
  // Scheduled (a postponement, or a row we have not refreshed yet) is NOT a
  // result — it was previously shown under "Recent Results" with no score.
  const { data: claimsData } = await supabase.auth.getClaims();
  const favorites = await getFavorites(supabase, claimsData?.claims?.sub as string | undefined);
  const isFavTeam = (name: string) => favorites.teams.has(teamKey(meta.slug, name));

  // Day is the primary sort; favorites only break ties within the same day.
  const isFavGame = (g: Score) => gameIsFavorite(favorites, meta.slug, g);
  const finished = byDayThenFavorites(
    played.filter((s) => gameState(s.status) !== "scheduled"),
    (s) => s.game_date,
    isFavGame,
    "desc",
  );
  const unplayed = played.filter((s) => gameState(s.status) === "scheduled");
  // Anything past its start time but still unplayed belongs with the schedule.
  const schedule = byDayThenFavorites(
    [...unplayed, ...upcoming],
    (s) => s.game_date,
    isFavGame,
    "asc",
  );

  // Teams seen in this league's games, for the directory
  const teamMap = new Map<string, string>(); // name → abbrev
  for (const s of scores) {
    if (s.home_team) teamMap.set(s.home_team, s.home_abbrev ?? s.home_team.slice(0, 3).toUpperCase());
    if (s.away_team) teamMap.set(s.away_team, s.away_abbrev ?? s.away_team.slice(0, 3).toUpperCase());
  }
  const teams = favoritesFirst(
    [...teamMap.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ([name]) => isFavTeam(name),
  );

  const accent = meta.accent;

  function GameCell({ g }: { g: Score }) {
    const state = gameState(g.status);
    const url = g.event_id ? espnGameUrl(meta!.slug, g.event_id) : null;
    const away = (g.away_abbrev ?? g.away_team.slice(0, 3)).toUpperCase();
    const home = (g.home_abbrev ?? g.home_team.slice(0, 3)).toUpperCase();
    const awayWon = state === "final" && (g.away_score ?? 0) > (g.home_score ?? 0);
    const homeWon = state === "final" && (g.home_score ?? 0) > (g.away_score ?? 0);
    const when = g.game_date
      ? formatDate(g.game_date)
      : "";
    const tip = formatGameTime(g.game_date);
    const liveStatus = compactStatus(g.status_detail);

    return (
      <div className="tap-row relative bg-background px-2 py-2 hover:bg-secondary/50 transition-colors">
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            aria-label="Open game on ESPN" className="absolute inset-0" />
        )}
        {/* One grid across the row: the container allocates width and the
            team columns truncate under pressure. Fixed ch widths overflowed
            once these cells sat in a 2- or 3-up grid. */}
        <div className="grid items-center gap-x-1 text-[11px] font-mono overflow-hidden [grid-template-columns:2.6rem_minmax(3.5ch,1fr)_auto_auto_auto_minmax(3.5ch,1fr)_2.2rem]">
          <span className="text-[9px] text-muted-foreground truncate">{when}</span>
          <Link href={`/${meta!.slug}/${away}`}
            className={`relative z-10 flex items-center justify-end gap-1 font-black hover:underline text-right truncate ${state === "final" && !awayWon ? "text-muted-foreground" : ""}`}>
            {g.away_logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.away_logo} alt="" className="w-3.5 h-3.5 shrink-0 object-contain" />
            )}
            <span className="truncate">{away}</span>
            <FavoriteStar show={isFavTeam(g.away_team)} />
          </Link>
          <span className={`text-right tabular-nums ${state === "final" && !awayWon ? "text-muted-foreground" : "font-bold"}`}>
            {state === "scheduled" ? "" : g.away_score ?? ""}
          </span>
          <span className="text-[8px] text-center text-muted-foreground/50">
            {state === "scheduled" ? "@" : "–"}
          </span>
          <span className={`text-left tabular-nums ${state === "final" && !homeWon ? "text-muted-foreground" : "font-bold"}`}>
            {state === "scheduled" ? "" : g.home_score ?? ""}
          </span>
          <Link href={`/${meta!.slug}/${home}`}
            className={`relative z-10 flex items-center justify-start gap-1 font-black hover:underline text-left truncate ${state === "final" && !homeWon ? "text-muted-foreground" : ""}`}>
            <span className="truncate">{home}</span>
            <FavoriteStar show={isFavTeam(g.home_team)} />
            {g.home_logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.home_logo} alt="" className="w-3.5 h-3.5 shrink-0 object-contain" />
            )}
          </Link>
          {state === "live" ? (
            <span className="flex flex-col items-end leading-none text-[8px]"
              style={{ color: "hsl(142 65% 42%)" }} title={g.status_detail ?? "Live"}>
              <span className="truncate max-w-full">{liveStatus.top}</span>
              {liveStatus.bottom && <span className="truncate max-w-full">{liveStatus.bottom}</span>}
            </span>
          ) : (
            <span className="text-[8px] uppercase text-muted-foreground text-right truncate">
              {state === "final" ? "Final" : tip}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-2xl font-black tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
            <span style={{ color: accent }}>◉</span> {leagueRow.display_name}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground">
              {scores.length} games · {news.length} articles
            </span>
            <a
              href={`https://www.espn.com/${meta.espn}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono tracking-widest uppercase border border-border px-2 py-1 hover:border-foreground transition-colors"
            >
              ESPN ↗
            </a>
          </div>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          <Link href="/sports" className="hover:text-foreground">SPORTS</Link> · {meta.label}
        </p>
      </div>

      {standingsGroups.length > 0 && (
        <section>
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
            Standings
          </p>
          <div
            className={`grid grid-cols-1 gap-px bg-border border border-border ${
              standingsGroups.length > 1 ? "md:grid-cols-2" : ""
            }`}
          >
            {standingsGroups.map((group) => (
              <div key={group.conference ?? "all"} className="bg-background">
                {group.conference && (
                  <p className="px-3 py-1.5 text-[9px] font-mono tracking-widest uppercase text-muted-foreground border-b border-border">
                    {group.conference}
                  </p>
                )}
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground text-[9px] uppercase">
                      <th className="text-left font-normal px-3 py-1">Team</th>
                      <th className="text-right font-normal px-1.5 py-1">W</th>
                      <th className="text-right font-normal px-1.5 py-1">L</th>
                      {group.teams.some((t) => t.ties != null) && (
                        <th className="text-right font-normal px-1.5 py-1">T</th>
                      )}
                      <th className="text-right font-normal px-1.5 py-1">PCT</th>
                      <th className="text-right font-normal px-3 py-1">GB</th>
                      <th className="text-right font-normal px-3 py-1">Streak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.teams.map((t) => (
                      <tr key={t.team_abbrev} className="border-t border-border hover:bg-secondary/50">
                        <td className="px-3 py-1.5 truncate">
                          <Link href={`/${meta!.slug}/${t.team_abbrev}`} className="flex items-center gap-1.5 hover:underline">
                            {t.logo && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={t.logo} alt="" className="w-4 h-4 shrink-0 object-contain" />
                            )}
                            <span className="truncate">{t.team_name ?? t.team_abbrev}</span>
                            <FavoriteStar show={isFavTeam(t.team_name ?? "")} />
                          </Link>
                        </td>
                        <td className="text-right px-1.5 py-1.5 tabular-nums">{t.wins ?? "–"}</td>
                        <td className="text-right px-1.5 py-1.5 tabular-nums">{t.losses ?? "–"}</td>
                        {group.teams.some((x) => x.ties != null) && (
                          <td className="text-right px-1.5 py-1.5 tabular-nums">{t.ties ?? "–"}</td>
                        )}
                        <td className="text-right px-1.5 py-1.5 tabular-nums">
                          {t.win_percent != null
                            ? t.win_percent.toFixed(3).replace(/^0/, "")
                            : t.points != null
                              ? t.points
                              : "–"}
                        </td>
                        <td className="text-right px-3 py-1.5 text-muted-foreground">{t.games_behind ?? "–"}</td>
                        <td className="text-right px-3 py-1.5 text-muted-foreground">{t.streak ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}

      {scores.length === 0 && news.length === 0 ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">NO DATA FOR THIS LEAGUE YET</p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <>
          {finished.length > 0 && (
            <section>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
                Scores <span className="normal-case tracking-normal text-muted-foreground/60">· {finished.length}</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border border border-border">
                {finished.map((g) => <GameCell key={g.id} g={g} />)}
              </div>
            </section>
          )}

          {schedule.length > 0 && (
            <section>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
                Schedule <span className="normal-case tracking-normal text-muted-foreground/60">· {schedule.length}</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border border border-border">
                {schedule.map((g) => <GameCell key={g.id} g={g} />)}
              </div>
            </section>
          )}

          {teams.length > 0 && (
            <section>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
                Teams
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-px bg-border border border-border">
                {teams.map(([name, abbrev]) => (
                  <Link key={name} href={`/${meta.slug}/${abbrev}`}
                    className="bg-background px-3 py-2 hover:bg-secondary/50 transition-colors">
                    <p className="text-[11px] font-mono font-bold flex items-center gap-1">
                      {abbrev}
                      <FavoriteStar show={isFavTeam(name)} />
                    </p>
                    <p className="text-[9px] text-muted-foreground truncate">{name}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {news.length > 0 && (
            <section>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
                {meta.label} News — ESPN
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
                {news.map((n) => (
                  <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
                    className="bg-background px-4 py-3 hover:bg-secondary/50 transition-colors group">
                    <p className="text-xs font-semibold leading-snug group-hover:underline line-clamp-2">
                      {n.title}
                    </p>
                    {n.description && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{n.description}</p>
                    )}
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

