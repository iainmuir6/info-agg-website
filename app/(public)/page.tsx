import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { CollapsibleCard } from "@/components/collapsible-card";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteRow = {
  ticker: string;
  name?: string | null;
  asset_type: string;
  quote: {
    current_price: number;
    percent_change: number;
  } | null;
};

type CompanyNewsItem = {
  id: string;
  headline: string;
  url: string;
  source: string | null;
  published_at: string | null;
  related_tickers: string[] | null;
};

type NyTimesArticle = {
  id: string;
  title: string;
  section: string | null;
  source: string | null;
  url: string;
  published_at: string | null;
};

type LeagueRow = {
  id: string;
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
  id: string;
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

const ASSET_TYPE_ORDER = ["stock", "etf", "forex", "commodity"] as const;

function assetTypeLabel(t: string): string {
  const m: Record<string, string> = {
    stock: "Stocks",
    etf: "ETFs",
    forex: "FX",
    commodity: "Commodities",
  };
  return m[t] ?? t;
}

function latestQuoteRow(s: any): QuoteRow {
  const quotes = (s.stock_quotes ?? []).sort(
    (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
  );
  return {
    ticker: s.ticker,
    name: s.name,
    asset_type: (s.asset_type as string) ?? "stock",
    quote: quotes[0] ?? null,
  };
}

/** Derive a compact 2-3 char abbreviation from a team display name. */
function abbrevTeam(name: string): string {
  if (!name) return "—";
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  // Initials from each word, up to 3
  const initials = words.map((w) => w[0].toUpperCase()).join("");
  if (initials.length >= 3) return initials.slice(0, 3);
  // Pad with chars from the last (longest) word
  const last = words[words.length - 1].toUpperCase();
  return (initials + last.slice(1)).slice(0, 3);
}

async function getCoreStocksBundle(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{
  watchlistNonCrypto: QuoteRow[];
  cryptoQuotes: QuoteRow[];
  coreTickers: string[];
}> {
  try {
    const { data } = await supabase
      .from("stocks")
      .select("ticker, name, asset_type, stock_quotes(current_price, percent_change, fetched_at)")
      .eq("is_core", true)
      .eq("is_active", true);

    const rows = (data ?? []).map(latestQuoteRow);
    const coreTickers = [...new Set(rows.map((r) => r.ticker).filter(Boolean))];
    const withQuote = rows.filter((r) => r.quote);
    return {
      watchlistNonCrypto: withQuote.filter((r) => r.asset_type !== "crypto"),
      cryptoQuotes: withQuote.filter((r) => r.asset_type === "crypto"),
      coreTickers,
    };
  } catch {
    return { watchlistNonCrypto: [], cryptoQuotes: [], coreTickers: [] };
  }
}

function groupQuotesByAssetType(rows: QuoteRow[]): Map<string, QuoteRow[]> {
  const map = new Map<string, QuoteRow[]>();
  for (const r of rows) {
    const at = r.asset_type || "stock";
    if (!map.has(at)) map.set(at, []);
    map.get(at)!.push(r);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  return map;
}

async function getCryptoMarketHeadlines(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at")
      .eq("category", "crypto")
      .order("published_at", { ascending: false })
      .limit(3);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getCompanyNews(
  supabase: Awaited<ReturnType<typeof createClient>>,
  coreTickers: string[]
): Promise<CompanyNewsItem[]> {
  if (coreTickers.length === 0) return [];
  try {
    const { data } = await supabase
      .from("company_news")
      .select("id, headline, url, source, published_at, related_tickers")
      .overlaps("related_tickers", coreTickers)
      .order("published_at", { ascending: false })
      .limit(14);
    return (data ?? []) as CompanyNewsItem[];
  } catch {
    return [];
  }
}

async function getMarketNews(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at, related_tickers, category")
      .order("published_at", { ascending: false })
      .limit(18);
    return data ?? [];
  } catch {
    return [];
  }
}

/** Single query; split client-side. Uses existing `section` for grouping (no schema changes). */
async function getNytRecentForHome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  total: number
): Promise<NyTimesArticle[]> {
  try {
    const { data } = await supabase
      .from("news_articles")
      .select("id, title, section, source, url, published_at")
      .eq("source", "nyt")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(total);
    return (data ?? []) as NyTimesArticle[];
  } catch {
    return [];
  }
}

function groupNytBySection(articles: NyTimesArticle[]): { section: string; items: NyTimesArticle[] }[] {
  const map = new Map<string, NyTimesArticle[]>();
  for (const a of articles) {
    const key = (a.section?.trim() || "General") || "General";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
  return keys.map((section) => ({ section, items: map.get(section)! }));
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
      className="text-[10px] font-mono font-bold tabular-nums leading-none"
      style={{ color: isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
    >
      {isPos ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="px-2.5 py-4 text-center">
      <p className="text-[9px] font-mono text-muted-foreground leading-snug">{msg}</p>
    </div>
  );
}

/** Compact single-line score row with abbreviated team names */
function ScoreRow({ game }: { game: ScoreRowType }) {
  const status = (game.status ?? "").toLowerCase();
  const isLive = status.includes("in") || status.includes("progress") || status.includes("live");
  const isFinal = status.includes("final");

  const awayAbbr = abbrevTeam(game.away_team);
  const homeAbbr = abbrevTeam(game.home_team);

  return (
    <div className="flex items-center gap-1 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors text-[10px] font-mono leading-tight">
      <span className="font-black w-7 shrink-0 tabular-nums">{awayAbbr}</span>
      <span className="font-bold tabular-nums w-4 text-right shrink-0">{game.away_score ?? "—"}</span>
      <span className="text-muted-foreground text-[9px] shrink-0">–</span>
      <span className="font-bold tabular-nums w-4 shrink-0">{game.home_score ?? "—"}</span>
      <span className="font-black w-7 shrink-0">{homeAbbr}</span>
      {isLive && (
        <>
          <div
            className="w-1 h-1 rounded-full animate-pulse-dot shrink-0"
            style={{ backgroundColor: "hsl(0 72% 50%)" }}
          />
          <span className="text-[8px] leading-none shrink-0 truncate" style={{ color: "hsl(0 72% 50%)" }}>
            {game.status_detail ?? "LIVE"}
          </span>
        </>
      )}
      {isFinal && (
        <span className="text-[8px] text-muted-foreground shrink-0">FINAL</span>
      )}
    </div>
  );
}

const NYT_FIRST = 28;
const NYT_TOTAL = 44;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CommandCenter() {
  const supabase = await createClient();
  const coreBundle = await getCoreStocksBundle(supabase);

  const [
    cryptoHeadlines,
    companyNews,
    marketNews,
    nytAll,
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
    getCryptoMarketHeadlines(supabase),
    getCompanyNews(supabase, coreBundle.coreTickers),
    getMarketNews(supabase),
    getNytRecentForHome(supabase, NYT_TOTAL),
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

  const nytFirstSlice = nytAll.slice(0, NYT_FIRST);
  const nytSecondSlice = nytAll.slice(NYT_FIRST, NYT_TOTAL);
  const nytGrouped = groupNytBySection(nytFirstSlice);

  const watchlistByType = groupQuotesByAssetType(coreBundle.watchlistNonCrypto);
  const watchlistOrdered: { type: string; rows: QuoteRow[] }[] = ASSET_TYPE_ORDER.filter(
    (t) => (watchlistByType.get(t)?.length ?? 0) > 0
  ).map((t) => ({ type: t, rows: watchlistByType.get(t)! }));
  const orderedSet = new Set<string>(ASSET_TYPE_ORDER);
  for (const [t, rows] of watchlistByType) {
    if (!orderedSet.has(t)) {
      watchlistOrdered.push({ type: t, rows });
    }
  }

  const hasWatchlist = coreBundle.watchlistNonCrypto.length > 0;
  const hasCryptoQuotes = coreBundle.cryptoQuotes.length > 0;
  const hasCryptoHeadlines = cryptoHeadlines.length > 0;
  const hasCryptoCard = hasCryptoQuotes || hasCryptoHeadlines;
  const hasCompanyNews = companyNews.length > 0;
  const hasMarketNews = marketNews.length > 0;
  const hasNytTop = nytFirstSlice.length > 0;
  const hasNytMore = nytSecondSlice.length > 0;
  const hasSpotify = spotifyReleases.length > 0;
  const hasReddit = redditPosts.length > 0;

  const sportsSnapshots = { nba, mlb, nfl, nhl, ncaab, ncaaf, wnba };

  // ── Watchlist summary ──────────────────────────────────────────────────────
  const watchlistSummary = watchlistOrdered
    .map(({ type, rows }) => `${rows.length} ${assetTypeLabel(type).toLowerCase()}`)
    .join(" · ");

  // ── NYT section count ──────────────────────────────────────────────────────
  const nytSectionCount = nytGrouped.length;

  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4 auto-rows-min">

        {/* Core watchlist — 3-column ticker grid, no name */}
        <CollapsibleCard
          label="Core Watchlist"
          accent="hsl(142 65% 42%)"
          href="/markets"
          count={coreBundle.watchlistNonCrypto.length}
          summary={watchlistSummary}
          className="md:col-span-2 xl:col-span-2"
        >
          {!hasWatchlist ? (
            <EmptyState msg="No core quotes — run ETL or check is_core stocks" />
          ) : (
            <div className="max-h-[min(70vh,520px)] overflow-y-auto">
              {watchlistOrdered.map(({ type, rows }) => (
                <div key={type}>
                  <p className="px-2 py-1 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border sticky top-0">
                    {assetTypeLabel(type)}
                  </p>
                  <div className="grid grid-cols-3">
                    {rows.map((s) => {
                      const pct = parseFloat(String(s.quote?.percent_change ?? 0));
                      const price = parseFloat(String(s.quote?.current_price ?? 0));
                      return (
                        <div
                          key={s.ticker}
                          className="flex items-center justify-between gap-1 px-2 py-1 border-b border-r border-border hover:bg-secondary/50 transition-colors"
                        >
                          <span className="text-[10px] font-mono font-black shrink-0">{s.ticker}</span>
                          <div className="flex flex-col items-end shrink-0 min-w-0">
                            <span className="text-[9px] font-mono tabular-nums font-bold leading-none">
                              ${price.toFixed(2)}
                            </span>
                            <ChangeTag pct={pct} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* Crypto: quotes first, then headlines */}
        <CollapsibleCard
          label="Crypto"
          accent="hsl(45 93% 47%)"
          href="/markets"
          count={hasCryptoQuotes ? coreBundle.cryptoQuotes.length : undefined}
          summary={`${coreBundle.cryptoQuotes.length} coins · ${cryptoHeadlines.length} headlines`}
        >
          {!hasCryptoCard ? (
            <EmptyState msg="No core crypto quotes or headlines" />
          ) : (
            <div>
              {hasCryptoQuotes && (
                <div className="border-b border-border">
                  {coreBundle.cryptoQuotes.map((s) => {
                    const pct = parseFloat(String(s.quote?.percent_change ?? 0));
                    const price = parseFloat(String(s.quote?.current_price ?? 0));
                    return (
                      <div
                        key={s.ticker}
                        className="flex items-center justify-between px-2 py-1 border-b border-border last:border-b-0 hover:bg-secondary/50 transition-colors"
                      >
                        <span className="text-[10px] font-mono font-black">{s.ticker}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono tabular-nums font-bold">
                            ${price.toFixed(2)}
                          </span>
                          <ChangeTag pct={pct} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {hasCryptoHeadlines && (
                <div>
                  {cryptoHeadlines.map((item: any) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                    >
                      <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                        {item.headline}
                      </p>
                      {item.source && (
                        <span className="text-[8px] font-mono text-muted-foreground">{item.source}</span>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </CollapsibleCard>

        {/* Company news */}
        <CollapsibleCard
          label="Stock News"
          accent="hsl(142 65% 42%)"
          href="/markets"
          count={companyNews.length}
          summary={`${companyNews.length} articles`}
        >
          {!hasCompanyNews ? (
            <EmptyState msg="No company news for core tickers" />
          ) : (
            <div>
              {companyNews.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                    {item.headline}
                  </p>
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                    {item.source && (
                      <span className="text-[8px] font-mono text-muted-foreground">{item.source}</span>
                    )}
                    {(item.related_tickers ?? []).slice(0, 4).map((t) => (
                      <span key={t} className="text-[8px] font-mono px-0.5 bg-secondary leading-none">
                        {t}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* Market news */}
        <CollapsibleCard
          label="Market News"
          accent="hsl(142 65% 42%)"
          href="/markets"
          count={marketNews.length}
          summary={`${marketNews.length} articles`}
        >
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
                  className="block px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-1 flex-wrap">
                    {item.category && (
                      <span
                        className="text-[8px] font-mono uppercase tracking-wider"
                        style={{ color: "hsl(142 65% 42%)" }}
                      >
                        {item.category}
                      </span>
                    )}
                    {item.source && (
                      <span className="text-[8px] font-mono text-muted-foreground">· {item.source}</span>
                    )}
                  </div>
                  <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                    {item.headline}
                  </p>
                </a>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* NYT — grouped by section */}
        <CollapsibleCard
          label="NYT — By Section"
          accent="hsl(220 90% 52%)"
          href="/news"
          count={nytFirstSlice.length}
          summary={`${nytFirstSlice.length} articles · ${nytSectionCount} sections`}
          className="md:col-span-2"
        >
          {!hasNytTop ? (
            <EmptyState msg="No NYT articles (source=nyt)" />
          ) : (
            <div className="max-h-[min(60vh,440px)] overflow-y-auto">
              {nytGrouped.map(({ section, items }) => (
                <div key={section}>
                  <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border sticky top-0">
                    {section}
                  </p>
                  {items.map((a) => (
                    <a
                      key={a.id}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-2 py-1 border-b border-border hover:bg-secondary/50 transition-colors group"
                    >
                      <p className="text-[10px] font-semibold leading-tight line-clamp-1 group-hover:underline">
                        {a.title}
                      </p>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* NYT — more recent */}
        <CollapsibleCard
          label="NYT — More"
          accent="hsl(220 90% 52%)"
          href="/news"
          count={nytSecondSlice.length}
          summary={`${nytSecondSlice.length} articles`}
        >
          {!hasNytMore ? (
            <EmptyState msg="No additional NYT rows" />
          ) : (
            <div>
              {nytSecondSlice.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-1">
                    {a.section && (
                      <span className="text-[8px] font-mono text-muted-foreground shrink-0">{a.section}</span>
                    )}
                  </div>
                  <p className="text-[10px] leading-tight line-clamp-1 group-hover:underline">{a.title}</p>
                </a>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* Sports */}
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

          const totalGames = snap.recentGames.length + snap.upcomingGames.length;
          const sportsSummary = [
            totalGames > 0 && `${totalGames} games`,
            snap.news.length > 0 && `${snap.news.length} news`,
          ]
            .filter(Boolean)
            .join(" · ") || (offSeason ? "off season" : "no data");

          return (
            <CollapsibleCard
              key={key}
              label={labelMap[key] ?? snap.league.display_name}
              accent="hsl(25 95% 50%)"
              href="/sports"
              count={totalGames || undefined}
              summary={sportsSummary}
            >
              {!hasScores && snap.news.length === 0 ? (
                <EmptyState msg={offSeason ? "Off season — no data" : "No games yet"} />
              ) : (
                <div>
                  {offSeason && (
                    <p className="px-2 py-1 text-[8px] font-mono text-muted-foreground uppercase tracking-widest border-b border-border">
                      Off season — news only
                    </p>
                  )}

                  {snap.recentGames.length > 0 && (
                    <div>
                      <p className="px-2 py-0.5 text-[8px] font-mono text-muted-foreground uppercase tracking-widest bg-secondary/40 border-b border-border">
                        Recent
                      </p>
                      {snap.recentGames.map((g, i) => (
                        <ScoreRow key={`recent-${i}`} game={g} />
                      ))}
                    </div>
                  )}

                  {snap.upcomingGames.length > 0 && (
                    <div>
                      <p className="px-2 py-0.5 text-[8px] font-mono text-muted-foreground uppercase tracking-widest bg-secondary/40 border-b border-border">
                        Upcoming
                      </p>
                      {snap.upcomingGames.map((g, i) => (
                        <ScoreRow key={`upcoming-${i}`} game={g} />
                      ))}
                    </div>
                  )}

                  {snap.news.length > 0 && (
                    <div>
                      <p className="px-2 py-0.5 text-[8px] font-mono text-muted-foreground uppercase tracking-widest bg-secondary/40 border-b border-border">
                        News
                      </p>
                      <div>
                        {snap.news.map((n) => (
                          <a
                            key={n.id}
                            href={n.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block px-2 py-1 border-b border-border last:border-0 text-[10px] leading-tight line-clamp-1 hover:underline hover:bg-secondary/50 transition-colors"
                          >
                            {n.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CollapsibleCard>
          );
        })}

        {/* Spotify */}
        <CollapsibleCard
          label="Spotify"
          accent="hsl(340 78% 50%)"
          href="/media"
          count={spotifyReleases.length}
          summary={`${spotifyReleases.length} releases`}
        >
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
                  className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="w-6 h-6 shrink-0 bg-secondary flex items-center justify-center text-[10px]">
                    <span style={{ color: "hsl(340 78% 50%)" }}>♫</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold line-clamp-1 group-hover:underline">{r.name}</p>
                    <p className="text-[8px] text-muted-foreground line-clamp-1">
                      {(r.artists ?? []).join(", ")}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* Reddit */}
        <CollapsibleCard
          label="Reddit"
          accent="hsl(220 15% 60%)"
          href="/media"
          count={redditPosts.length}
          summary={`${redditPosts.length} posts`}
        >
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
                  className="block px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[8px] font-mono text-muted-foreground truncate">r/{p.subreddit}</span>
                    <span className="text-[8px] font-mono text-muted-foreground shrink-0">▲ {p.score}</span>
                  </div>
                  <p className="text-[10px] leading-tight line-clamp-1 group-hover:underline">{p.title}</p>
                </a>
              ))}
            </div>
          )}
        </CollapsibleCard>

      </div>
    </div>
  );
}
