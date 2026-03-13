import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteRow = {
  ticker: string;
  name?: string | null;
  quote: {
    current_price: number;
    percent_change: number;
  } | null;
};

type CompanyNewsItem = {
  id: number;
  headline: string;
  url: string;
  source: string | null;
  published_at: string | null;
  related_tickers: string[] | null;
};

type NyTimesArticle = {
  id: number;
  title: string;
  section: string | null;
  source: string | null;
  url: string;
  published_at: string | null;
};

type LeagueRow = {
  id: number;
  sport: string;
  league: string;
  display_name: string;
  is_active: boolean;
};

type ScoreRowType = {
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  status_detail: string | null;
  game_date: string | null;
};

type SportsNewsItem = {
  id: number;
  title: string;
  url: string;
  published_at: string | null;
  source: string;
};

type LeagueSnapshot = {
  league: LeagueRow | null;
  recentGames: ScoreRowType[];
  upcomingGames: ScoreRowType[];
  news: SportsNewsItem[];
};

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getEquityQuotes(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<QuoteRow[]> {
  const MAG7 = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "META", "TSLA"];
  try {
    const { data } = await supabase
      .from("stocks")
      .select(`ticker, name, stock_quotes(current_price, percent_change, fetched_at)`)
      .in("ticker", MAG7)
      .eq("is_active", true);

    return (data ?? [])
      .map((s: any) => {
        const quotes = (s.stock_quotes ?? []).sort(
          (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
        );
        return { ticker: s.ticker, name: s.name, quote: quotes[0] ?? null };
      })
      .filter((s: any) => s.quote)
      .sort((a: any, b: any) => MAG7.indexOf(a.ticker) - MAG7.indexOf(b.ticker));
  } catch {
    return [];
  }
}

async function getEtfQuotes(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<QuoteRow[]> {
  const ETFS = ["SPY", "QQQ", "DIA", "IWM", "VTI"];
  try {
    const { data } = await supabase
      .from("stocks")
      .select(`ticker, name, stock_quotes(current_price, percent_change, fetched_at)`)
      .in("ticker", ETFS)
      .eq("is_active", true);

    return (data ?? [])
      .map((s: any) => {
        const quotes = (s.stock_quotes ?? []).sort(
          (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
        );
        return { ticker: s.ticker, name: s.name, quote: quotes[0] ?? null };
      })
      .filter((s: any) => s.quote);
  } catch {
    return [];
  }
}

async function getCryptoNews(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at, related_tickers")
      .eq("category", "crypto")
      .order("published_at", { ascending: false })
      .limit(6);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getCompanyNews(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<CompanyNewsItem[]> {
  try {
    const MAG7 = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "META", "TSLA"];
    const { data } = await supabase
      .from("company_news")
      .select("id, headline, url, source, published_at, related_tickers")
      .contains("related_tickers", MAG7.slice(0, 3)) // basic filter for key names
      .order("published_at", { ascending: false })
      .limit(10);
    return (data ?? []) as CompanyNewsItem[];
  } catch {
    return [];
  }
}

async function getMarketNews(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<CompanyNewsItem[]> {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at, related_tickers, category")
      .order("published_at", { ascending: false })
      .limit(20);
    return (data ?? []) as any;
  } catch {
    return [];
  }
}

async function getNyTimesTopStories(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<NyTimesArticle[]> {
  try {
    const { data } = await supabase
      .from("news_articles")
      .select("id, title, section, source, url, published_at, image_url")
      .eq("source", "NYT Top Stories")
      .order("published_at", { ascending: false })
      .limit(8);
    return (data ?? []) as NyTimesArticle[];
  } catch {
    return [];
  }
}

async function getNyTimesMore(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<NyTimesArticle[]> {
  try {
    const { data } = await supabase
      .from("news_articles")
      .select("id, title, section, source, url, published_at, image_url")
      .neq("source", "NYT Top Stories")
      .order("published_at", { ascending: false })
      .limit(8);
    return (data ?? []) as NyTimesArticle[];
  } catch {
    return [];
  }
}

async function getSpotifyReleases(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("spotify_releases")
      .select("id, name, artists, album_type, release_date, image_url, external_url")
      .order("release_date", { ascending: false })
      .limit(5);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getRedditTopPosts(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("reddit_posts")
      .select("id, subreddit, title, score, url, created_at")
      .order("score", { ascending: false })
      .limit(6);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getLeagueSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sport: string,
  league: string,
  scoreLimit = 6,
  newsLimit = 4
): Promise<LeagueSnapshot> {
  try {
    const { data: leagueRow } = await supabase
      .from("leagues")
      .select("id, sport, league, display_name, is_active")
      .eq("sport", sport)
      .eq("league", league)
      .single();

    if (!leagueRow) {
      return { league: null, recentGames: [], upcomingGames: [], news: [] };
    }

    const [scoresRes, newsRes] = await Promise.all([
      supabase
        .from("sports_scores")
        .select(
          "home_team, away_team, home_score, away_score, status, status_detail, game_date"
        )
        .eq("league_id", leagueRow.id)
        .order("game_date", { ascending: false })
        .limit(scoreLimit * 2),
      supabase
        .from("sports_news")
        .select("id, title, url, published_at, source")
        .eq("league_id", leagueRow.id)
        .order("published_at", { ascending: false })
        .limit(newsLimit),
    ]);

    const scores = (scoresRes.data ?? []) as ScoreRowType[];
    const now = new Date();

    const isRecent = (g: ScoreRowType) => {
      const status = (g.status ?? "").toLowerCase();
      if (status.includes("final") || status.includes("post")) return true;
      if (status.includes("in") || status.includes("live") || status.includes("progress")) return true;
      const dt = g.game_date ? new Date(g.game_date) : null;
      return !!dt && dt < now;
    };

    const recentGames = scores
      .filter(isRecent)
      .sort(
        (a, b) =>
          new Date(b.game_date ?? "").getTime() - new Date(a.game_date ?? "").getTime()
      )
      .slice(0, scoreLimit);

    const upcomingGames = scores
      .filter((g) => !isRecent(g))
      .sort(
        (a, b) =>
          new Date(a.game_date ?? "").getTime() - new Date(b.game_date ?? "").getTime()
      )
      .slice(0, scoreLimit);

    const news = (newsRes.data ?? []) as SportsNewsItem[];

    if (!leagueRow.is_active) {
      // Off-season: show news only
      return {
        league: leagueRow as LeagueRow,
        recentGames: [],
        upcomingGames: [],
        news,
      };
    }

    return {
      league: leagueRow as LeagueRow,
      recentGames,
      upcomingGames,
      news,
    };
  } catch {
    return { league: null, recentGames: [], upcomingGames: [], news: [] };
  }
}

// ─── Helper components ────────────────────────────────────────────────────────

function ChangeTag({ pct }: { pct: number }) {
  const isPos = pct >= 0;
  return (
    <span
      className="text-xs font-mono font-bold tabular-nums"
      style={{ color: isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
    >
      {isPos ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function CardHeader({
  label,
  accent,
  href,
  count,
}: {
  label: string;
  accent: string;
  href: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 shrink-0" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold" style={{ color: accent }}>
          {label}
        </span>
        {count != null && (
          <span className="text-[10px] font-mono text-muted-foreground">{count}</span>
        )}
      </div>
      <Link
        href={href}
        className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
      >
        All →
      </Link>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-[10px] font-mono text-muted-foreground">{msg}</p>
    </div>
  );
}

function ScoreRow({ game }: { game: ScoreRowType }) {
  const status = (game.status ?? "").toLowerCase();
  const isLive = status.includes("in") || status.includes("progress") || status.includes("live");
  const isFinal = status.includes("final");

  return (
    <div className="px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground w-[38%] truncate">{game.away_team}</span>
        <div className="flex items-center gap-2">
          <span className="font-bold tabular-nums w-6 text-right">{game.away_score ?? "—"}</span>
          <span className="text-muted-foreground text-[10px]">–</span>
          <span className="font-bold tabular-nums w-6">{game.home_score ?? "—"}</span>
        </div>
        <span className="text-muted-foreground w-[38%] truncate text-right">{game.home_team}</span>
      </div>
      {isLive && (
        <div className="flex items-center gap-1 mt-0.5">
          <div className="w-1 h-1 rounded-full animate-pulse-dot" style={{ backgroundColor: "hsl(0 72% 50%)" }} />
          <span className="text-[9px] font-mono" style={{ color: "hsl(0 72% 50%)" }}>
            {game.status_detail ?? "LIVE"}
          </span>
        </div>
      )}
      {isFinal && (
        <p className="text-[9px] font-mono text-muted-foreground mt-0.5">FINAL</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CommandCenter() {
  const supabase = await createClient();

  const [
    equities,
    etfs,
    cryptoNews,
    companyNews,
    marketNews,
    nytTop,
    nytMore,
    spotifyReleases,
    redditPosts,
    nba,
    mlb,
    nfl,
    nhl,
    ncaab,
    ncaaf,
    wnba,
  ] = await Promise.all([
    getEquityQuotes(supabase),
    getEtfQuotes(supabase),
    getCryptoNews(supabase),
    getCompanyNews(supabase),
    getMarketNews(supabase),
    getNyTimesTopStories(supabase),
    getNyTimesMore(supabase),
    getSpotifyReleases(supabase),
    getRedditTopPosts(supabase),
    getLeagueSnapshot(supabase, "basketball", "nba"),
    getLeagueSnapshot(supabase, "baseball", "mlb"),
    getLeagueSnapshot(supabase, "football", "nfl"),
    getLeagueSnapshot(supabase, "hockey", "nhl"),
    getLeagueSnapshot(supabase, "basketball", "ncaab"),
    getLeagueSnapshot(supabase, "football", "ncaaf"),
    getLeagueSnapshot(supabase, "basketball", "wnba"),
  ]);

  const hasEquities = equities.length > 0;
  const hasEtfs = etfs.length > 0;
  const hasCrypto = cryptoNews.length > 0;
  const hasCompanyNews = companyNews.length > 0;
  const hasMarketNews = marketNews.length > 0;
  const hasNytTop = nytTop.length > 0;
  const hasNytMore = nytMore.length > 0;
  const hasSpotify = spotifyReleases.length > 0;
  const hasReddit = redditPosts.length > 0;

  const sportsSnapshots = { nba, mlb, nfl, nhl, ncaab, ncaaf, wnba };

  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4 auto-rows-min">
        {/* Stocks / Equities */}
        <div className="border border-border bg-card">
          <CardHeader
            label="Equities — MAG7"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={equities.length}
          />
          {!hasEquities ? (
            <EmptyState msg="Run ETL to sync stock data" />
          ) : (
            <div>
              {equities.map((s) => {
                const pct = parseFloat(String(s.quote?.percent_change ?? 0));
                const price = parseFloat(String(s.quote?.current_price ?? 0));
                return (
                  <div
                    key={s.ticker}
                    className="flex items-center justify-between px-3 py-1.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
                  >
                    <span className="text-[11px] font-mono font-black w-12">{s.ticker}</span>
                    <span className="text-[10px] text-muted-foreground flex-1 truncate px-1 hidden sm:block">
                      {s.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono tabular-nums font-bold">
                        ${price.toFixed(2)}
                      </span>
                      <ChangeTag pct={pct} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ETFs */}
        <div className="border border-border bg-card">
          <CardHeader label="Stocks — ETFs" accent="hsl(142 65% 42%)" href="/markets" />
          {!hasEtfs ? (
            <EmptyState msg="No ETF data" />
          ) : (
            <div>
              {etfs.map((s) => {
                const pct = parseFloat(String(s.quote?.percent_change ?? 0));
                const price = parseFloat(String(s.quote?.current_price ?? 0));
                return (
                  <div
                    key={s.ticker}
                    className="flex items-center justify-between px-3 py-1.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
                  >
                    <span className="text-[11px] font-mono font-black">{s.ticker}</span>
                    <div className="flex flex-col items-end">
                      <span className="text-[11px] font-mono tabular-nums font-bold">
                        ${price.toFixed(2)}
                      </span>
                      <ChangeTag pct={pct} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Crypto news */}
        <div className="border border-border bg-card">
          <CardHeader label="Crypto" accent="hsl(45 93% 47%)" href="/markets" />
          {!hasCrypto ? (
            <EmptyState msg="No crypto data" />
          ) : (
            <div>
              {cryptoNews.map((item: any) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <p className="text-[11px] font-medium leading-snug line-clamp-2 group-hover:underline">
                    {item.headline}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {item.source && (
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {item.source}
                      </span>
                    )}
                    {(item.related_tickers ?? []).slice(0, 2).map((t: string) => (
                      <span
                        key={t}
                        className="text-[9px] font-mono px-1 bg-secondary"
                        style={{ color: "hsl(45 93% 47%)" }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Stock company news */}
        <div className="border border-border bg-card">
          <CardHeader
            label="Stock News"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={companyNews.length}
          />
          {!hasCompanyNews ? (
            <EmptyState msg="No stock news" />
          ) : (
            <div>
              {companyNews.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <p className="text-[11px] font-medium leading-snug line-clamp-2 group-hover:underline">
                    {item.headline}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {item.source && (
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {item.source}
                      </span>
                    )}
                    {(item.related_tickers ?? []).slice(0, 2).map((t) => (
                      <span key={t} className="text-[9px] font-mono px-1 bg-secondary">
                        {t}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Market news */}
        <div className="border border-border bg-card">
          <CardHeader
            label="Market News"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={marketNews.length}
          />
          {!hasMarketNews ? (
            <EmptyState msg="No market news" />
          ) : (
            <div>
              {marketNews.map((item: any) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {item.category && (
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider"
                        style={{ color: "hsl(142 65% 42%)" }}
                      >
                        {item.category}
                      </span>
                    )}
                    {item.source && (
                      <span className="text-[9px] font-mono text-muted-foreground">
                        · {item.source}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-medium leading-snug line-clamp-2 group-hover:underline">
                    {item.headline}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* NYT Top Stories */}
        <div className="border border-border bg-card">
          <CardHeader
            label="NYT — Top Stories"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={nytTop.length}
          />
          {!hasNytTop ? (
            <EmptyState msg="No NYT top stories" />
          ) : (
            <div>
              {nytTop.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {a.section && (
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider"
                        style={{ color: "hsl(220 90% 52%)" }}
                      >
                        {a.section}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold leading-snug line-clamp-2 group-hover:underline">
                    {a.title}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* NYT More */}
        <div className="border border-border bg-card">
          <CardHeader
            label="NYT — More"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={nytMore.length}
          />
          {!hasNytMore ? (
            <EmptyState msg="No additional NYT articles" />
          ) : (
            <div>
              {nytMore.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {a.section && (
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {a.section}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-medium leading-snug line-clamp-2 group-hover:underline">
                    {a.title}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Sports cards */}
        {Object.entries(sportsSnapshots).map(([key, snapshot]) => {
          const snap = snapshot as LeagueSnapshot;
          if (!snap.league) return null;
          const hasScores = snap.recentGames.length > 0 || snap.upcomingGames.length > 0;
          const offSeason = !snap.league.is_active;

          const labelMap: Record<string, string> = {
            nba: "NBA",
            mlb: "MLB",
            nfl: "NFL",
            nhl: "NHL",
            ncaab: "NCAAB",
            ncaaf: "NCAAF",
            wnba: "WNBA",
          };

          return (
            <div key={key} className="border border-border bg-card">
              <CardHeader
                label={labelMap[key] ?? snap.league.display_name}
                accent="hsl(25 95% 50%)"
                href="/sports"
                count={snap.recentGames.length + snap.upcomingGames.length}
              />
              {!hasScores && snap.news.length === 0 ? (
                <EmptyState msg={offSeason ? "Off season — no data" : "No games yet"} />
              ) : (
                <div className="px-3 py-2 space-y-2">
                  {offSeason && (
                    <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
                      Off season — news only
                    </p>
                  )}

                  {snap.recentGames.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">
                        Recent
                      </p>
                      {snap.recentGames.map((g, i) => (
                        <ScoreRow key={`recent-${i}`} game={g} />
                      ))}
                    </div>
                  )}

                  {snap.upcomingGames.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground uppercase mt-1 mb-1">
                        Upcoming
                      </p>
                      {snap.upcomingGames.map((g, i) => (
                        <ScoreRow key={`upcoming-${i}`} game={g} />
                      ))}
                    </div>
                  )}

                  {snap.news.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground uppercase mt-1 mb-1">
                        News
                      </p>
                      <div className="space-y-1">
                        {snap.news.map((n) => (
                          <a
                            key={n.id}
                            href={n.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[11px] leading-snug line-clamp-2 hover:underline"
                          >
                            {n.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Spotify new releases */}
        <div className="border border-border bg-card">
          <CardHeader
            label="Spotify — New Releases"
            accent="hsl(340 78% 50%)"
            href="/media"
            count={spotifyReleases.length}
          />
          {!hasSpotify ? (
            <EmptyState msg="No Spotify data" />
          ) : (
            <div>
              {spotifyReleases.map((r: any) => (
                <a
                  key={r.id}
                  href={r.external_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="w-7 h-7 shrink-0 bg-secondary flex items-center justify-center">
                    <span
                      className="text-[11px]"
                      style={{ color: "hsl(340 78% 50%)" }}
                    >
                      ♫
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold line-clamp-1 group-hover:underline">
                      {r.name}
                    </p>
                    <p className="text-[9px] text-muted-foreground line-clamp-1">
                      {(r.artists ?? []).join(", ")}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Reddit top posts */}
        <div className="border border-border bg-card">
          <CardHeader
            label="Reddit — Top Posts"
            accent="hsl(220 15% 60%)"
            href="/media"
            count={redditPosts.length}
          />
          {!hasReddit ? (
            <EmptyState msg="No Reddit data" />
          ) : (
            <div>
              {redditPosts.map((p: any) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-mono text-muted-foreground">
                      r/{p.subreddit}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground">
                      ▲ {p.score}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug line-clamp-2 group-hover:underline">
                    {p.title}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
