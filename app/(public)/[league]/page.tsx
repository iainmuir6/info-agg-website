import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LEAGUES, leagueBySlug, espnGameUrl } from "@/lib/leagues";
import { compactStatus } from "@/lib/sports-status";

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

  const [scoresRes, newsRes] = await Promise.all([
    supabase
      .from("sports_scores")
      .select("id, event_id, home_team, away_team, home_abbrev, away_abbrev, home_score, away_score, status, status_detail, game_date, venue, broadcast")
      .eq("league_id", leagueRow.id)
      .order("game_date", { ascending: false })
      .limit(120),
    supabase
      .from("sports_news")
      .select("id, title, description, url, image_url, published_at")
      .eq("league_id", leagueRow.id)
      .order("published_at", { ascending: false })
      .limit(20),
  ]);

  const scores = (scoresRes.data ?? []) as Score[];
  const news = newsRes.data ?? [];

  const now = Date.now();
  const past = scores
    .filter((s) => gameState(s.status) !== "scheduled" || new Date(s.game_date ?? 0).getTime() < now)
    .slice(0, 24);
  const upcoming = scores
    .filter((s) => gameState(s.status) === "scheduled" && new Date(s.game_date ?? 0).getTime() >= now)
    .sort((a, b) => new Date(a.game_date ?? 0).getTime() - new Date(b.game_date ?? 0).getTime())
    .slice(0, 12);

  // Teams seen in this league's games, for the directory
  const teamMap = new Map<string, string>(); // name → abbrev
  for (const s of scores) {
    if (s.home_team) teamMap.set(s.home_team, s.home_abbrev ?? s.home_team.slice(0, 3).toUpperCase());
    if (s.away_team) teamMap.set(s.away_team, s.away_abbrev ?? s.away_team.slice(0, 3).toUpperCase());
  }
  const teams = [...teamMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  const accent = meta.accent;

  function GameCell({ g }: { g: Score }) {
    const state = gameState(g.status);
    const url = g.event_id ? espnGameUrl(meta!.slug, g.event_id) : null;
    const away = (g.away_abbrev ?? g.away_team.slice(0, 3)).toUpperCase();
    const home = (g.home_abbrev ?? g.home_team.slice(0, 3)).toUpperCase();
    const awayWon = state === "final" && (g.away_score ?? 0) > (g.home_score ?? 0);
    const homeWon = state === "final" && (g.home_score ?? 0) > (g.away_score ?? 0);
    const when = g.game_date
      ? new Date(g.game_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";
    const tip = g.game_date
      ? new Date(g.game_date).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        })
      : "";
    const liveStatus = compactStatus(g.status_detail);

    return (
      <div className="relative bg-background px-2 py-2 hover:bg-secondary/50 transition-colors">
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
            className={`relative z-10 font-black hover:underline text-right truncate ${state === "final" && !awayWon ? "text-muted-foreground" : ""}`}>
            {away}
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
            className={`relative z-10 font-black hover:underline text-left truncate ${state === "final" && !homeWon ? "text-muted-foreground" : ""}`}>
            {home}
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

      {scores.length === 0 && news.length === 0 ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">NO DATA FOR THIS LEAGUE YET</p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
                Upcoming
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border border border-border">
                {upcoming.map((g) => <GameCell key={g.id} g={g} />)}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
                Recent Results
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border border border-border">
                {past.map((g) => <GameCell key={g.id} g={g} />)}
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
                    <p className="text-[11px] font-mono font-bold">{abbrev}</p>
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

