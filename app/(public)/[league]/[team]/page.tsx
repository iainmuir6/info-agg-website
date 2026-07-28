import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { leagueBySlug, espnGameUrl, espnTeamUrl } from "@/lib/leagues";
import { FavoriteTeamButton } from "@/components/favorite-team-button";

type Score = {
  id: string;
  event_id: string | null;
  home_team: string;
  away_team: string;
  home_abbrev: string | null;
  away_abbrev: string | null;
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

export default async function TeamPage({
  params,
}: {
  params: Promise<{ league: string; team: string }>;
}) {
  const { league: leagueParam, team: teamParam } = await params;
  const meta = leagueBySlug(leagueParam);
  if (!meta) notFound();

  const supabase = await createClient();

  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("id, sport, league, display_name")
    .eq("league", meta.slug)
    .maybeSingle();
  if (!leagueRow) notFound();

  // Slugs are team abbreviations (e.g. /wnba/DAL). Legacy full-name links
  // still resolve via the name match below.
  const slug = decodeURIComponent(teamParam).toUpperCase();

  const { data: scoreRows } = await supabase
    .from("sports_scores")
    .select("id, event_id, home_team, away_team, home_abbrev, away_abbrev, home_score, away_score, status, status_detail, game_date, venue, broadcast")
    .eq("league_id", leagueRow.id)
    .order("game_date", { ascending: false })
    .limit(400);

  const all = (scoreRows ?? []) as Score[];
  const matches = (s: Score, side: "home" | "away") => {
    const abbrev = (side === "home" ? s.home_abbrev : s.away_abbrev)?.toUpperCase();
    const name = (side === "home" ? s.home_team : s.away_team)?.toUpperCase();
    return abbrev === slug || name === slug;
  };

  const games = all.filter((s) => matches(s, "home") || matches(s, "away"));
  if (games.length === 0) notFound();

  const sample = games[0];
  const isHomeSample = matches(sample, "home");
  const teamName = isHomeSample ? sample.home_team : sample.away_team;
  const teamAbbrev = (isHomeSample ? sample.home_abbrev : sample.away_abbrev)?.toUpperCase() ?? slug;

  // Record from completed games
  let wins = 0;
  let losses = 0;
  for (const g of games) {
    if (gameState(g.status) !== "final") continue;
    const home = matches(g, "home");
    const own = home ? g.home_score : g.away_score;
    const opp = home ? g.away_score : g.home_score;
    if (own == null || opp == null) continue;
    if (own > opp) wins++;
    else if (own < opp) losses++;
  }

  const now = Date.now();
  const results = games.filter((g) => gameState(g.status) === "final").slice(0, 30);
  const upcoming = games
    .filter((g) => gameState(g.status) !== "final" && new Date(g.game_date ?? 0).getTime() >= now)
    .sort((a, b) => new Date(a.game_date ?? 0).getTime() - new Date(b.game_date ?? 0).getTime())
    .slice(0, 8);

  const { data: claimsData } = await supabase.auth.getClaims();
  const signedIn = !!claimsData?.claims;
  let initialFavorited = false;
  if (signedIn) {
    const { data: fav } = await supabase
      .from("watchlist_teams")
      .select("id")
      .eq("league_id", leagueRow.id)
      .eq("team_name", teamName)
      .maybeSingle();
    initialFavorited = !!fav;
  }

  const accent = meta.accent;

  function ResultCell({ g }: { g: Score }) {
    const home = matches(g, "home");
    const own = home ? g.home_score : g.away_score;
    const opp = home ? g.away_score : g.home_score;
    const oppAbbrev = ((home ? g.away_abbrev : g.home_abbrev) ?? (home ? g.away_team : g.home_team).slice(0, 3)).toUpperCase();
    const state = gameState(g.status);
    const won = state === "final" && own != null && opp != null && own > opp;
    const lost = state === "final" && own != null && opp != null && own < opp;
    const url = g.event_id ? espnGameUrl(meta!.slug, g.event_id) : null;
    const when = g.game_date
      ? new Date(g.game_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";
    const tip = g.game_date
      ? new Date(g.game_date).toLocaleTimeString("en-US", {
          hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
        })
      : "";

    return (
      <div className="relative bg-background px-3 py-2 hover:bg-secondary/50 transition-colors">
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            aria-label="Open game on ESPN" className="absolute inset-0" />
        )}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="text-[9px] text-muted-foreground w-10 shrink-0">{when}</span>
          {state === "final" ? (
            <span className="font-black w-3 shrink-0"
              style={{ color: won ? "hsl(142 65% 42%)" : lost ? "hsl(0 72% 50%)" : undefined }}>
              {won ? "W" : lost ? "L" : "–"}
            </span>
          ) : (
            <span className="w-3 shrink-0 text-muted-foreground">·</span>
          )}
          <span className="text-muted-foreground shrink-0">{home ? "vs" : "@"}</span>
          <Link href={`/${meta!.slug}/${oppAbbrev}`}
            className="relative z-10 font-bold hover:underline shrink-0">
            {oppAbbrev}
          </Link>
          <span className="flex-1" />
          <span className="tabular-nums font-bold shrink-0">
            {state === "final" ? `${own ?? "–"}–${opp ?? "–"}` : tip}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black tracking-tight leading-none"
              style={{ fontFamily: "Georgia, serif" }}>
              <span style={{ color: accent }}>◉</span> {teamName}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Link href={`/${meta.slug}`}
                className="text-xs font-mono font-bold tracking-widest uppercase hover:underline"
                style={{ color: accent }}>
                {leagueRow.display_name}
              </Link>
              <span className="text-[10px] font-mono text-muted-foreground">{teamAbbrev}</span>
              <FavoriteTeamButton
                leagueId={leagueRow.id}
                teamName={teamName}
                initialFavorited={initialFavorited}
                signedIn={signedIn}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {(wins > 0 || losses > 0) && (
              <div className="text-right">
                <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Record</p>
                <p className="text-2xl font-black font-mono tabular-nums leading-none">
                  {wins}–{losses}
                </p>
              </div>
            )}
            <a
              href={espnTeamUrl(meta.slug, teamAbbrev)}
              target="_blank"
              rel="noopener noreferrer"
              title={`${teamName} on ESPN`}
              className="flex items-center gap-1.5 border border-border px-3 py-2 hover:border-foreground transition-colors"
            >
              <span className="text-[11px] font-black tracking-tight" style={{ color: "hsl(0 72% 50%)" }}>
                ESPN
              </span>
              <span className="text-xs">↗</span>
            </a>
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <section>
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
            Upcoming
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
            {upcoming.map((g) => <ResultCell key={g.id} g={g} />)}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section>
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
            Recent Results — {results.length} games
          </p>
          {/* Grid keeps a full schedule compact instead of one row per game */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-border border border-border">
            {results.map((g) => <ResultCell key={g.id} g={g} />)}
          </div>
        </section>
      )}
    </div>
  );
}
