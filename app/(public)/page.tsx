import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { CollapsibleCard } from "@/components/collapsible-card";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteRow = {
  ticker: string;
  name?: string | null;
  asset_type: string;
  quote: { current_price: number; percent_change: number } | null;
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

type EconRow = {
  indicator_name: string;
  date: string;
  value: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

// NYT sections we treat as "US" vs "World"
const NYT_US_SECTIONS = new Set(["us", "politics", "nyregion", "national"]);
const NYT_WORLD_SECTIONS = new Set(["world"]);

// Friendly labels + formatting for economic indicators
const ECON_CONFIG: Record<string, { label: string; fmt: (v: number) => string; group: string }> = {
  treasury_1y:  { label: "1Y",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Yield Curve" },
  treasury_2y:  { label: "2Y",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Yield Curve" },
  treasury_3y:  { label: "3Y",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Yield Curve" },
  treasury_5y:  { label: "5Y",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Yield Curve" },
  treasury_10y: { label: "10Y",           fmt: (v) => `${v.toFixed(2)}%`,  group: "Yield Curve" },
  treasury_30y: { label: "30Y",           fmt: (v) => `${v.toFixed(2)}%`,  group: "Yield Curve" },
  federalFunds: { label: "Fed Funds",     fmt: (v) => `${v.toFixed(2)}%`,  group: "Macro" },
  realGDP:      { label: "Real GDP",      fmt: (v) => `$${(v / 1000).toFixed(1)}T`, group: "Macro" },
  CPI:          { label: "CPI",           fmt: (v) => v.toFixed(1),        group: "Macro" },
  unemploymentRate:   { label: "Unemployment", fmt: (v) => `${v.toFixed(1)}%`, group: "Macro" },
  inflationRate:      { label: "Inflation",    fmt: (v) => `${v.toFixed(2)}%`, group: "Macro" },
  "30YearFixedRateMortgageAverage": { label: "30Y Mortgage", fmt: (v) => `${v.toFixed(2)}%`, group: "Macro" },
  initialClaims: { label: "Init. Claims", fmt: (v) => `${(v / 1000).toFixed(0)}K`, group: "Macro" },
};

// ─── Height helpers ───────────────────────────────────────────────────────────

/**
 * Returns "half" (h-36, 144px) if the estimated content height is under half
 * of the full card (288px), otherwise "full" (h-72).
 */
function tickerCardHeight(count: number): "half" | "full" {
  // 3-col grid: ceil(count/3) rows × 28px each
  return Math.ceil(count / 3) * 28 < 144 ? "half" : "full";
}

function newsCardHeight(count: number): "half" | "full" {
  // ~32px per news item
  return count * 32 < 144 ? "half" : "full";
}

function indicatorCardHeight(count: number): "half" | "full" {
  // ~28px per row; add group headers (~20px each, assume 2)
  return count * 28 + 40 < 144 ? "half" : "full";
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function getCoreAssetsByType(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("stocks")
      .select("ticker, name, asset_type, stock_quotes(current_price, percent_change, fetched_at)")
      .eq("is_core", true)
      .eq("is_active", true);

    const withQuote = (data ?? [])
      .map((s: any) => {
        const quotes = (s.stock_quotes ?? []).sort(
          (a: any, b: any) =>
            new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
        );
        return {
          ticker: s.ticker as string,
          name: s.name as string | null,
          asset_type: (s.asset_type as string) ?? "stock",
          quote: quotes[0]
            ? { current_price: quotes[0].current_price, percent_change: quotes[0].percent_change }
            : null,
        } satisfies QuoteRow;
      })
      .filter((r) => r.quote !== null);

    const byType = (type: string) =>
      withQuote
        .filter((r) => r.asset_type === type)
        .sort((a, b) => a.ticker.localeCompare(b.ticker));

    return {
      stocks: byType("stock"),
      etfs: byType("etf"),
      forex: byType("forex"),
      commodities: byType("commodity"),
      crypto: byType("crypto"),
      coreTickers: [...new Set(withQuote.map((r) => r.ticker))],
    };
  } catch {
    return { stocks: [], etfs: [], forex: [], commodities: [], crypto: [], coreTickers: [] };
  }
}

async function getCompanyNews(
  supabase: Awaited<ReturnType<typeof createClient>>,
  coreTickers: string[]
): Promise<CompanyNewsItem[]> {
  try {
    // Try filtered by core tickers first
    if (coreTickers.length > 0) {
      const { data } = await supabase
        .from("company_news")
        .select("id, headline, url, source, published_at, related_tickers")
        .overlaps("related_tickers", coreTickers)
        .order("published_at", { ascending: false })
        .limit(16);
      if (data && data.length > 0) return data as CompanyNewsItem[];
    }
    // Fallback: most recent company news regardless of ticker
    const { data } = await supabase
      .from("company_news")
      .select("id, headline, url, source, published_at, related_tickers")
      .order("published_at", { ascending: false })
      .limit(16);
    return (data ?? []) as CompanyNewsItem[];
  } catch {
    return [];
  }
}

async function getCryptoHeadlines(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at")
      .eq("category", "crypto")
      .order("published_at", { ascending: false })
      .limit(6);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getMarketNews(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at, category")
      .not("category", "eq", "crypto") // crypto has its own card
      .order("published_at", { ascending: false })
      .limit(20);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getAllNyt(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<NyTimesArticle[]> {
  try {
    const { data } = await supabase
      .from("news_articles")
      .select("id, title, section, url, published_at")
      .eq("source", "nyt")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(100);
    return (data ?? []) as NyTimesArticle[];
  } catch {
    return [];
  }
}

async function getSpotifyReleases(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("spotify_releases")
      .select("id, name, artists, album_type, release_date, external_url")
      .order("release_date", { ascending: false })
      .limit(10);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getEconomicIndicators(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<EconRow[]> {
  try {
    const { data } = await supabase
      .from("economic_indicators")
      .select("indicator_name, date, value")
      .order("date", { ascending: false });
    if (!data) return [];
    // Deduplicate: keep latest value per indicator
    const seen = new Set<string>();
    const result: EconRow[] = [];
    for (const row of data) {
      if (!seen.has(row.indicator_name)) {
        seen.add(row.indicator_name);
        result.push({ indicator_name: row.indicator_name, date: row.date, value: parseFloat(String(row.value)) });
      }
    }
    return result;
  } catch {
    return [];
  }
}

async function getLeagueSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sport: string,
  league: string,
  scoreLimit = 8,
  newsLimit = 6
): Promise<LeagueSnapshot> {
  try {
    const { data: leagueRow } = await supabase
      .from("leagues")
      .select("id, sport, league, display_name, is_active")
      .eq("sport", sport)
      .eq("league", league)
      .single();

    if (!leagueRow) return { league: null, recentGames: [], upcomingGames: [], news: [] };

    const [scoresRes, newsRes] = await Promise.all([
      supabase
        .from("sports_scores")
        .select("home_team, away_team, home_score, away_score, status, status_detail, game_date")
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
      const s = (g.status ?? "").toLowerCase();
      if (s.includes("final") || s.includes("post")) return true;
      if (s.includes("in") || s.includes("live") || s.includes("progress")) return true;
      const dt = g.game_date ? new Date(g.game_date) : null;
      return !!dt && dt < now;
    };

    const recentGames = scores
      .filter(isRecent)
      .sort((a, b) => new Date(b.game_date ?? "").getTime() - new Date(a.game_date ?? "").getTime())
      .slice(0, scoreLimit);

    const upcomingGames = scores
      .filter((g) => !isRecent(g))
      .sort((a, b) => new Date(a.game_date ?? "").getTime() - new Date(b.game_date ?? "").getTime())
      .slice(0, scoreLimit);

    const news = (newsRes.data ?? []) as SportsNewsItem[];

    return {
      league: leagueRow as LeagueRow,
      recentGames: leagueRow.is_active ? recentGames : [],
      upcomingGames: leagueRow.is_active ? upcomingGames : [],
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

/** Ticker 3-column grid — used for stocks, etfs, forex, commodities, crypto quotes */
function TickerGrid({ rows, href }: { rows: QuoteRow[]; href: string }) {
  return (
    <div className="grid grid-cols-3">
      {rows.map((s) => {
        const pct = parseFloat(String(s.quote?.percent_change ?? 0));
        const price = parseFloat(String(s.quote?.current_price ?? 0));
        return (
          <Link
            key={s.ticker}
            href={href.startsWith("/sports") ? href : `/markets/${s.ticker}`}
            className="flex items-center justify-between gap-1 px-2 py-1 border-b border-r border-border hover:bg-secondary/50 transition-colors group"
          >
            <span className="text-[10px] font-mono font-black shrink-0 group-hover:underline">
              {s.ticker}
            </span>
            <div className="flex flex-col items-end shrink-0 min-w-0">
              <span className="text-[9px] font-mono tabular-nums font-bold leading-none">
                ${price.toFixed(2)}
              </span>
              <ChangeTag pct={pct} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** Compact 3-char team abbreviation */
function abbrevTeam(name: string): string {
  if (!name) return "—";
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  const initials = words.map((w) => w[0].toUpperCase()).join("");
  if (initials.length >= 3) return initials.slice(0, 3);
  const last = words[words.length - 1].toUpperCase();
  return (initials + last.slice(1)).slice(0, 3);
}

function ScoreRow({ game, leagueSlug }: { game: ScoreRowType; leagueSlug: string }) {
  const status = (game.status ?? "").toLowerCase();
  const isLive = status.includes("in") || status.includes("progress") || status.includes("live");
  const isFinal = status.includes("final");

  return (
    <div className="flex items-center gap-1 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors text-[10px] font-mono leading-tight">
      <Link
        href={`/sports/${leagueSlug}/${encodeURIComponent(game.away_team)}`}
        title={game.away_team}
        className="font-black w-7 shrink-0 tabular-nums hover:underline"
      >
        {abbrevTeam(game.away_team)}
      </Link>
      <span className="font-bold tabular-nums w-4 text-right shrink-0">{game.away_score ?? "—"}</span>
      <span className="text-muted-foreground text-[9px] shrink-0">–</span>
      <span className="font-bold tabular-nums w-4 shrink-0">{game.home_score ?? "—"}</span>
      <Link
        href={`/sports/${leagueSlug}/${encodeURIComponent(game.home_team)}`}
        title={game.home_team}
        className="font-black w-7 shrink-0 hover:underline"
      >
        {abbrevTeam(game.home_team)}
      </Link>
      {isLive && (
        <>
          <div className="w-1 h-1 rounded-full animate-pulse-dot shrink-0" style={{ backgroundColor: "hsl(0 72% 50%)" }} />
          <span className="text-[8px] leading-none shrink-0 truncate" style={{ color: "hsl(0 72% 50%)" }}>
            {game.status_detail ?? "LIVE"}
          </span>
        </>
      )}
      {isFinal && <span className="text-[8px] text-muted-foreground shrink-0">FINAL</span>}
    </div>
  );
}

/** Flat list of NYT article links */
function NytList({ articles }: { articles: NyTimesArticle[] }) {
  return (
    <div className="h-full overflow-y-auto">
      {articles.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
        >
          {a.section && (
            <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider">
              {a.section}
            </span>
          )}
          <p className="text-[10px] font-semibold leading-tight line-clamp-2 group-hover:underline">
            {a.title}
          </p>
        </a>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CommandCenter() {
  const supabase = await createClient();

  const assets = await getCoreAssetsByType(supabase);

  const [
    companyNews,
    cryptoHeadlines,
    marketNews,
    nytAll,
    spotifyReleases,
    econIndicators,
    nba, mlb, nfl, nhl, ncaab, ncaaf, wnba,
  ] = await Promise.all([
    getCompanyNews(supabase, assets.coreTickers),
    getCryptoHeadlines(supabase),
    getMarketNews(supabase),
    getAllNyt(supabase),
    getSpotifyReleases(supabase),
    getEconomicIndicators(supabase),
    getLeagueSnapshot(supabase, "basketball", "nba"),
    getLeagueSnapshot(supabase, "baseball", "mlb"),
    getLeagueSnapshot(supabase, "football", "nfl"),
    getLeagueSnapshot(supabase, "hockey", "nhl"),
    getLeagueSnapshot(supabase, "basketball", "ncaab"),
    getLeagueSnapshot(supabase, "football", "ncaaf"),
    getLeagueSnapshot(supabase, "basketball", "wnba"),
  ]);

  // ── NYT splits ────────────────────────────────────────────────────────────
  const usStories = nytAll.filter((a) => NYT_US_SECTIONS.has((a.section ?? "").toLowerCase()));
  const worldStories = nytAll.filter((a) => NYT_WORLD_SECTIONS.has((a.section ?? "").toLowerCase()));
  const otherStories = nytAll.filter(
    (a) =>
      !NYT_US_SECTIONS.has((a.section ?? "").toLowerCase()) &&
      !NYT_WORLD_SECTIONS.has((a.section ?? "").toLowerCase())
  );

  // ── Economic indicators grouped ───────────────────────────────────────────
  const econByGroup = econIndicators.reduce<Record<string, EconRow[]>>((acc, row) => {
    const cfg = ECON_CONFIG[row.indicator_name];
    const group = cfg?.group ?? "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(row);
    return acc;
  }, {});
  // Canonical order for treasury
  const TREASURY_ORDER = ["treasury_1y","treasury_2y","treasury_3y","treasury_5y","treasury_10y","treasury_30y"];
  if (econByGroup["Yield Curve"]) {
    econByGroup["Yield Curve"].sort(
      (a, b) => TREASURY_ORDER.indexOf(a.indicator_name) - TREASURY_ORDER.indexOf(b.indicator_name)
    );
  }

  // ── Crypto combined ───────────────────────────────────────────────────────
  const hasCryptoQuotes = assets.crypto.length > 0;
  const hasCryptoHeadlines = cryptoHeadlines.length > 0;
  const cryptoItemCount = assets.crypto.length + cryptoHeadlines.length;

  // ── Sports ────────────────────────────────────────────────────────────────
  const SPORTS_LABEL: Record<string, string> = {
    nba: "NBA", mlb: "MLB", nfl: "NFL", nhl: "NHL",
    ncaab: "NCAAB", ncaaf: "NCAAF", wnba: "WNBA",
  };
  const sportsSnapshots: Record<string, LeagueSnapshot> = {
    nba, mlb, nfl, nhl, ncaab, ncaaf, wnba,
  };

  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      {/*
        5-column grid on XL:
        Row 1: Stocks | ETFs | FX | Commodities | Econ Indicators
        Row 2: Crypto | Stock News(2) | Market News(2)
        Row 3: NYT US(2) | NYT World(2) | NYT Other(1)
        Rows 4-5: 7 sports leagues (1 each)
        Row 5 tail: Spotify(3)
      */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3 auto-rows-min">

        {/* ── Row 1: Asset type watchlist cards ─────────────────────────── */}

        {assets.stocks.length > 0 && (
          <CollapsibleCard
            label="Stocks"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={assets.stocks.length}
            summary={`${assets.stocks.length} stocks`}
            contentHeight={tickerCardHeight(assets.stocks.length)}
          >
            <div className="h-full overflow-y-auto">
              <TickerGrid rows={assets.stocks} href="/markets" />
            </div>
          </CollapsibleCard>
        )}

        {assets.etfs.length > 0 && (
          <CollapsibleCard
            label="ETFs"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={assets.etfs.length}
            summary={`${assets.etfs.length} ETFs`}
            contentHeight={tickerCardHeight(assets.etfs.length)}
          >
            <div className="h-full overflow-y-auto">
              <TickerGrid rows={assets.etfs} href="/markets" />
            </div>
          </CollapsibleCard>
        )}

        {assets.forex.length > 0 && (
          <CollapsibleCard
            label="FX"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={assets.forex.length}
            summary={`${assets.forex.length} pairs`}
            contentHeight={tickerCardHeight(assets.forex.length)}
          >
            <div className="h-full overflow-y-auto">
              <TickerGrid rows={assets.forex} href="/markets" />
            </div>
          </CollapsibleCard>
        )}

        {assets.commodities.length > 0 && (
          <CollapsibleCard
            label="Commodities"
            accent="hsl(45 93% 47%)"
            href="/markets"
            count={assets.commodities.length}
            summary={`${assets.commodities.length} commodities`}
            contentHeight={tickerCardHeight(assets.commodities.length)}
          >
            <div className="h-full overflow-y-auto">
              <TickerGrid rows={assets.commodities} href="/markets" />
            </div>
          </CollapsibleCard>
        )}

        {econIndicators.length > 0 && (
          <CollapsibleCard
            label="Economic Indicators"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={econIndicators.length}
            summary={`${econIndicators.length} indicators`}
            contentHeight={indicatorCardHeight(econIndicators.length)}
          >
            <div className="h-full overflow-y-auto">
              {Object.entries(econByGroup).map(([group, rows]) => (
                <div key={group}>
                  <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border sticky top-0">
                    {group}
                  </p>
                  {rows.map((row) => {
                    const cfg = ECON_CONFIG[row.indicator_name];
                    return (
                      <div
                        key={row.indicator_name}
                        className="flex items-center justify-between px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50"
                      >
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {cfg?.label ?? row.indicator_name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-mono font-bold tabular-nums">
                            {cfg ? cfg.fmt(row.value) : row.value.toFixed(2)}
                          </span>
                          <span className="text-[8px] font-mono text-muted-foreground">
                            {new Date(row.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CollapsibleCard>
        )}

        {/* ── Row 2: Market news ─────────────────────────────────────────── */}

        {(hasCryptoQuotes || hasCryptoHeadlines) && (
          <CollapsibleCard
            label="Crypto"
            accent="hsl(45 93% 47%)"
            href="/markets"
            count={hasCryptoQuotes ? assets.crypto.length : undefined}
            summary={`${assets.crypto.length} coins · ${cryptoHeadlines.length} headlines`}
            contentHeight={cryptoItemCount * 30 < 144 ? "half" : "full"}
          >
            <div className="h-full overflow-y-auto">
              {hasCryptoQuotes && (
                <div className="border-b border-border">
                  <TickerGrid rows={assets.crypto} href="/markets" />
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
          </CollapsibleCard>
        )}

        {companyNews.length > 0 && (
          <CollapsibleCard
            label="Stock News"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={companyNews.length}
            summary={`${companyNews.length} articles`}
            contentHeight={newsCardHeight(companyNews.length)}
            className="xl:col-span-2"
          >
            <div className="h-full overflow-y-auto">
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
                    {(item.related_tickers ?? []).slice(0, 3).map((t) => (
                      <Link
                        key={t}
                        href={`/markets/${t}`}
                        className="text-[8px] font-mono px-0.5 bg-secondary leading-none hover:bg-border"
                      >
                        {t}
                      </Link>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          </CollapsibleCard>
        )}

        {marketNews.length > 0 && (
          <CollapsibleCard
            label="Market News"
            accent="hsl(142 65% 42%)"
            href="/markets"
            count={marketNews.length}
            summary={`${marketNews.length} articles`}
            contentHeight={newsCardHeight(marketNews.length)}
            className="xl:col-span-2"
          >
            <div className="h-full overflow-y-auto">
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
          </CollapsibleCard>
        )}

        {/* ── Row 3: NYT ─────────────────────────────────────────────────── */}

        {usStories.length > 0 && (
          <CollapsibleCard
            label="Top Stories — US"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={usStories.length}
            summary={`${usStories.length} articles`}
            contentHeight={newsCardHeight(usStories.length)}
            className="xl:col-span-2"
          >
            <NytList articles={usStories} />
          </CollapsibleCard>
        )}

        {worldStories.length > 0 && (
          <CollapsibleCard
            label="Top Stories — World"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={worldStories.length}
            summary={`${worldStories.length} articles`}
            contentHeight={newsCardHeight(worldStories.length)}
            className="xl:col-span-2"
          >
            <NytList articles={worldStories} />
          </CollapsibleCard>
        )}

        {otherStories.length > 0 && (
          <CollapsibleCard
            label="NYT — Today"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={otherStories.length}
            summary={`${otherStories.length} articles`}
            contentHeight={newsCardHeight(otherStories.length)}
          >
            <NytList articles={otherStories} />
          </CollapsibleCard>
        )}

        {/* ── Rows 4-5: Sports ──────────────────────────────────────────── */}

        {Object.entries(sportsSnapshots).map(([key, snapshot]) => {
          const snap = snapshot as LeagueSnapshot;
          if (!snap.league) return null;

          const hasScores = snap.recentGames.length > 0 || snap.upcomingGames.length > 0;
          const hasNews = snap.news.length > 0;
          if (!hasScores && !hasNews) return null; // hide empty sports cards

          const offSeason = !snap.league.is_active;
          const totalGames = snap.recentGames.length + snap.upcomingGames.length;
          const sportsSummary =
            [
              totalGames > 0 && `${totalGames} games`,
              hasNews && `${snap.news.length} news`,
            ]
              .filter(Boolean)
              .join(" · ") || (offSeason ? "off season" : "no data");

          // Compact sports cards when very little data
          const totalItems = totalGames + snap.news.length;
          const sportsHeight = totalItems * 26 < 144 ? "half" : "full";

          return (
            <CollapsibleCard
              key={key}
              label={SPORTS_LABEL[key] ?? snap.league.display_name}
              accent="hsl(25 95% 50%)"
              href="/sports"
              count={totalGames || undefined}
              summary={sportsSummary}
              contentHeight={sportsHeight}
            >
              {/* Sub-columns: scores left, news right */}
              <div className="h-full grid grid-cols-2 divide-x divide-border">
                <div className="overflow-y-auto">
                  {offSeason && (
                    <p className="px-2 py-1 text-[8px] font-mono text-muted-foreground uppercase tracking-widest border-b border-border">
                      Off season
                    </p>
                  )}
                  {snap.recentGames.length > 0 && (
                    <div>
                      <p className="px-2 py-0.5 text-[8px] font-mono text-muted-foreground uppercase tracking-widest bg-secondary/40 border-b border-border sticky top-0">
                        Recent
                      </p>
                      {snap.recentGames.map((g, i) => (
                        <ScoreRow key={`r-${i}`} game={g} leagueSlug={snap.league!.league} />
                      ))}
                    </div>
                  )}
                  {snap.upcomingGames.length > 0 && (
                    <div>
                      <p className="px-2 py-0.5 text-[8px] font-mono text-muted-foreground uppercase tracking-widest bg-secondary/40 border-b border-border sticky top-0">
                        Next
                      </p>
                      {snap.upcomingGames.map((g, i) => (
                        <ScoreRow key={`u-${i}`} game={g} leagueSlug={snap.league!.league} />
                      ))}
                    </div>
                  )}
                  {!hasScores && (
                    <p className="px-2 py-2 text-[9px] font-mono text-muted-foreground">No games</p>
                  )}
                </div>
                <div className="overflow-y-auto">
                  {!hasNews ? (
                    <p className="px-2 py-2 text-[9px] font-mono text-muted-foreground">No news</p>
                  ) : (
                    snap.news.map((n) => (
                      <a
                        key={n.id}
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-2 py-1 border-b border-border last:border-0 text-[10px] leading-tight line-clamp-2 hover:underline hover:bg-secondary/50 transition-colors"
                      >
                        {n.title}
                      </a>
                    ))
                  )}
                </div>
              </div>
            </CollapsibleCard>
          );
        })}

        {/* ── Spotify ───────────────────────────────────────────────────── */}

        {spotifyReleases.length > 0 && (
          <CollapsibleCard
            label="Spotify"
            accent="hsl(340 78% 50%)"
            href="/media"
            count={spotifyReleases.length}
            summary={`${spotifyReleases.length} releases`}
            contentHeight={newsCardHeight(spotifyReleases.length)}
            className="xl:col-span-3"
          >
            <div className="h-full overflow-y-auto">
              {spotifyReleases.map((r: any) => (
                <a
                  key={r.id}
                  href={r.external_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <span className="text-[10px] shrink-0" style={{ color: "hsl(340 78% 50%)" }}>
                    ♫
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold line-clamp-1 group-hover:underline">{r.name}</p>
                    <p className="text-[8px] text-muted-foreground line-clamp-1">
                      {(r.artists ?? []).join(", ")}
                    </p>
                  </div>
                  {r.album_type && (
                    <span className="text-[8px] font-mono text-muted-foreground uppercase shrink-0">
                      {r.album_type}
                    </span>
                  )}
                </a>
              ))}
            </div>
          </CollapsibleCard>
        )}

      </div>
    </div>
  );
}
