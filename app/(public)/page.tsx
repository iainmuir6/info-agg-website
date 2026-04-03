import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Flag, Globe } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { MasonryColumns } from "@/components/masonry-columns";

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

// ─── Team abbreviation lookup ─────────────────────────────────────────────────

const TEAM_ABBREVS: Record<string, string> = {
  // NFL
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WSH",
  // NBA
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GS",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NO",
  "New York Knicks": "NY",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SA",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WSH",
  // NHL
  "Anaheim Ducks": "ANA",
  "Boston Bruins": "BOS",
  "Buffalo Sabres": "BUF",
  "Calgary Flames": "CGY",
  "Carolina Hurricanes": "CAR",
  "Chicago Blackhawks": "CHI",
  "Colorado Avalanche": "COL",
  "Columbus Blue Jackets": "CBJ",
  "Dallas Stars": "DAL",
  "Detroit Red Wings": "DET",
  "Edmonton Oilers": "EDM",
  "Florida Panthers": "FLA",
  "Los Angeles Kings": "LA",
  "Minnesota Wild": "MIN",
  "Montreal Canadiens": "MTL",
  "Nashville Predators": "NSH",
  "New Jersey Devils": "NJ",
  "New York Islanders": "NYI",
  "New York Rangers": "NYR",
  "Ottawa Senators": "OTT",
  "Philadelphia Flyers": "PHI",
  "Pittsburgh Penguins": "PIT",
  "San Jose Sharks": "SJ",
  "Seattle Kraken": "SEA",
  "St. Louis Blues": "STL",
  "Tampa Bay Lightning": "TB",
  "Toronto Maple Leafs": "TOR",
  "Utah Hockey Club": "UTA",
  "Vancouver Canucks": "VAN",
  "Vegas Golden Knights": "VGK",
  "Washington Capitals": "WSH",
  "Winnipeg Jets": "WPG",
  // MLB
  "Arizona Diamondbacks": "ARI",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  "Oakland Athletics": "OAK",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SD",
  "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
  // EPL
  "Arsenal": "ARS",
  "Aston Villa": "AVL",
  "Bournemouth": "BOU",
  "Brentford": "BRE",
  "Brighton and Hove Albion": "BHA",
  "Brighton & Hove Albion": "BHA",
  "Chelsea": "CHE",
  "Crystal Palace": "CRY",
  "Everton": "EVE",
  "Fulham": "FUL",
  "Ipswich Town": "IPS",
  "Leicester City": "LEI",
  "Liverpool": "LIV",
  "Manchester City": "MCI",
  "Manchester United": "MUN",
  "Newcastle United": "NEW",
  "Nottingham Forest": "NFO",
  "Southampton": "SOU",
  "Tottenham Hotspur": "TOT",
  "West Ham United": "WHU",
  "Wolverhampton Wanderers": "WOL",
};

// ─── Height helpers ───────────────────────────────────────────────────────────

function tickerCardHeight(count: number): "half" | "full" {
  return Math.ceil(count / 3) * 28 < 144 ? "half" : "full";
}

function newsCardHeight(count: number): "half" | "full" {
  return count * 32 < 144 ? "half" : "full";
}

function indicatorCardHeight(count: number): "half" | "full" {
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
    if (coreTickers.length > 0) {
      const { data } = await supabase
        .from("company_news")
        .select("id, headline, url, source, published_at, related_tickers")
        .overlaps("related_tickers", coreTickers)
        .order("published_at", { ascending: false })
        .limit(16);
      if (data && data.length > 0) return data as CompanyNewsItem[];
    }
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
      .not("category", "eq", "crypto")
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
      if (s.includes("progress") || s.includes("live")) return true;
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

// ─── Hub cap colors ───────────────────────────────────────────────────────────
// Maps lowercase source/section name → [background, text] CSS color strings.
const HUB_CAP_COLORS: Record<string, [string, string]> = {
  // ── News sources ──────────────────────────────────────────────────────────
  // Yahoo — purple
  "yahoo":                   ["rgba(123,0,153,0.13)", "#7B0099"],
  "yahoo finance":           ["rgba(123,0,153,0.13)", "#7B0099"],
  // CNBC — red
  "cnbc":                    ["rgba(198,42,42,0.13)",  "#C62A2A"],
  // Reuters — orange
  "reuters":                 ["rgba(255,140,0,0.13)",  "#D97600"],
  // Bloomberg — dark blue
  "bloomberg":               ["rgba(20,50,180,0.13)",  "#1432B4"],
  // AP / Associated Press — red
  "ap":                      ["rgba(198,42,42,0.13)",  "#C62A2A"],
  "associated press":        ["rgba(198,42,42,0.13)",  "#C62A2A"],
  // ESPN — red
  "espn":                    ["rgba(198,42,42,0.13)",  "#C62A2A"],
  // MarketWatch — green
  "marketwatch":             ["rgba(0,130,70,0.13)",   "#008246"],
  // Benzinga — blue
  "benzinga":                ["rgba(20,100,200,0.13)", "#1464C8"],
  // Seeking Alpha — teal-green
  "seeking alpha":           ["rgba(0,100,90,0.13)",   "#00645A"],
  // The Guardian — dark teal
  "guardian":                ["rgba(0,100,90,0.13)",   "#005E54"],
  "the guardian":            ["rgba(0,100,90,0.13)",   "#005E54"],
  // Washington Post — dark navy
  "washington post":         ["rgba(40,40,60,0.13)",   "#28283C"],
  // BBC — dark red
  "bbc":                     ["rgba(187,0,0,0.13)",    "#BB0000"],
  "bbc news":                ["rgba(187,0,0,0.13)",    "#BB0000"],
  // Forbes — dark
  "forbes":                  ["rgba(40,40,40,0.13)",   "#282828"],
  // Business Insider — dark
  "business insider":        ["rgba(40,40,40,0.13)",   "#282828"],
  // Motley Fool — dark purple
  "motley fool":             ["rgba(80,0,100,0.13)",   "#500064"],
  "the motley fool":         ["rgba(80,0,100,0.13)",   "#500064"],
  // Investopedia — blue
  "investopedia":            ["rgba(0,80,180,0.13)",   "#0050B4"],
  // WSJ
  "wsj":                     ["rgba(40,40,40,0.13)",   "#282828"],
  "wall street journal":     ["rgba(40,40,40,0.13)",   "#282828"],
  // Financial Times — salmon
  "ft":                      ["rgba(230,100,50,0.13)", "#E66432"],
  "financial times":         ["rgba(230,100,50,0.13)", "#E66432"],
  // Barron's
  "barron's":                ["rgba(40,40,40,0.13)",   "#282828"],
  "barrons":                 ["rgba(40,40,40,0.13)",   "#282828"],
  // Finnhub categories (market news)
  "general":                 ["rgba(80,100,140,0.13)", "#506496"],
  "forex":                   ["rgba(0,130,70,0.13)",   "#008246"],
  "crypto":                  ["rgba(245,160,0,0.13)",  "#B87800"],
  "merger":                  ["rgba(120,40,160,0.13)", "#7828A0"],
  // ── NYT sections ─────────────────────────────────────────────────────────
  "us":                      ["rgba(30,80,200,0.13)",  "#1E50C8"],
  "politics":                ["rgba(180,30,30,0.13)",  "#B41E1E"],
  "national":                ["rgba(30,80,200,0.13)",  "#1E50C8"],
  "nyregion":                ["rgba(30,80,200,0.13)",  "#1E50C8"],
  "world":                   ["rgba(0,110,80,0.13)",   "#006E50"],
  "business":                ["rgba(0,130,70,0.13)",   "#008246"],
  "technology":              ["rgba(0,100,210,0.13)",  "#0064D2"],
  "science":                 ["rgba(0,140,160,0.13)",  "#008CA0"],
  "health":                  ["rgba(220,60,60,0.13)",  "#DC3C3C"],
  "sports":                  ["rgba(220,100,0,0.13)",  "#DC6400"],
  "arts":                    ["rgba(160,0,100,0.13)",  "#A00064"],
  "theater":                 ["rgba(160,0,100,0.13)",  "#A00064"],
  "movies":                  ["rgba(160,0,100,0.13)",  "#A00064"],
  "books":                   ["rgba(100,60,20,0.13)",  "#643C14"],
  "food":                    ["rgba(220,120,0,0.13)",  "#DC7800"],
  "travel":                  ["rgba(0,120,180,0.13)",  "#0078B4"],
  "fashion":                 ["rgba(180,0,80,0.13)",   "#B40050"],
  "style":                   ["rgba(180,0,80,0.13)",   "#B40050"],
  "opinion":                 ["rgba(100,60,140,0.13)", "#643C8C"],
  "briefing":                ["rgba(60,80,120,0.13)",  "#3C5078"],
  "climate":                 ["rgba(0,120,60,0.13)",   "#007840"],
  "education":               ["rgba(0,80,160,0.13)",   "#0050A0"],
  "realestate":              ["rgba(80,60,40,0.13)",   "#503C28"],
  "automobiles":             ["rgba(60,60,60,0.13)",   "#3C3C3C"],
  "obituaries":              ["rgba(60,60,80,0.13)",   "#3C3C50"],
};

const DEFAULT_HUB_CAP: [string, string] = ["rgba(120,120,140,0.13)", "#78788C"];

function hubCapStyle(raw: string): { bg: string; fg: string } {
  const [bg, fg] = HUB_CAP_COLORS[raw.toLowerCase()] ?? DEFAULT_HUB_CAP;
  return { bg, fg };
}

// Short-form display labels — ONLY for raw labels longer than 8 characters.
// Labels ≤ 8 chars are shown as-is (the code never looks these up for short labels).
const LABEL_ABBREVS: Record<string, string> = {
  // ── News sources (all raw keys are > 8 chars) ─────────────────────────────
  "yahoo finance":        "YAHOO",
  "associated press":     "AP",
  "bloomberg":            "BBERG",    // 9 chars → abbreviate
  "marketwatch":          "MKTW",     // 11 chars
  "seeking alpha":        "SEEK A",   // 13 chars
  "the guardian":         "GUARDIAN", // 12 chars → fits in 8
  "washington post":      "WAPOST",   // 15 chars
  "business insider":     "BSINS",    // 16 chars
  "financial times":      "FT",       // 15 chars
  "the motley fool":      "MOTLEY",   // 15 chars
  "motley fool":          "MOTLEY",   // 11 chars
  "wall street journal":  "WSJ",      // 19 chars
  "investopedia":         "INVST",    // 12 chars
  // ── NYT sections (all raw keys are > 8 chars) ─────────────────────────────
  "technology":           "TECH",     // 10 chars
  "education":            "EDU",      // 9 chars
  "realestate":           "RE",       // 10 chars
  "automobiles":          "AUTO",     // 11 chars
  "obituaries":           "OBIT",     // 10 chars
};

/**
 * Hub cap text: abbreviate only when raw label exceeds 8 characters, then slice to HUB_LEN.
 * Visual centering is done in CSS (fixed width + flex) so glyphs stay centered in the pill.
 */
const HUB_LEN = 8;

function hubCapText(raw: string): string {
  const upper = raw.toUpperCase();
  const abbrev = upper.length > 8 ? LABEL_ABBREVS[raw.toLowerCase()] : undefined;
  return (abbrev ?? upper).slice(0, HUB_LEN);
}

/** Small source/section pill badge — fixed width, label centered inside. */
function HubCap({ label }: { label: string }) {
  if (!label) return null;
  const { bg, fg } = hubCapStyle(label);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center min-w-[8ch] w-[8ch] px-0.5 py-0.5 rounded text-[7px] font-mono leading-none whitespace-nowrap text-center"
      style={{ backgroundColor: bg, color: fg }}
      title={label}
    >
      {hubCapText(label)}
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

/** Look up official team abbreviation; fall back to computed initials */
function abbrevTeam(name: string): string {
  if (!name) return "—";
  if (TEAM_ABBREVS[name]) return TEAM_ABBREVS[name];
  // Fallback: initials from words
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  const initials = words.map((w) => w[0].toUpperCase()).join("");
  if (initials.length >= 3) return initials.slice(0, 3);
  const last = words[words.length - 1].toUpperCase();
  return (initials + last.slice(1)).slice(0, 3);
}

/** Exactly 3 monospace cells for team abbrev — away toward center, home toward center. */
function fixedAwayAbbrCell(raw: string): string {
  const s = raw.slice(0, 3).toUpperCase();
  return s.length >= 3 ? s : s.padStart(3, "\u00A0");
}

function fixedHomeAbbrCell(raw: string): string {
  const s = raw.slice(0, 3).toUpperCase();
  return s.length >= 3 ? s : s.padEnd(3, "\u00A0");
}

/** Exactly 3 monospace cells: away score hugs the center dash; home score hugs the center dash. */
function fixedAwayScoreCell(
  score: string | number | null | undefined,
  scheduled: boolean
): string {
  if (scheduled) return "\u00A0\u00A0–";
  if (score == null || score === "") return "\u00A0\u00A0–";
  const t = String(score).trim().slice(0, 3);
  return t.length >= 3 ? t : t.padStart(3, "\u00A0");
}

function fixedHomeScoreCell(
  score: string | number | null | undefined,
  scheduled: boolean
): string {
  if (scheduled) return "\u00A0\u00A0–";
  if (score == null || score === "") return "\u00A0\u00A0–";
  const t = String(score).trim().slice(0, 3);
  return t.length >= 3 ? t : t.padEnd(3, "\u00A0");
}

/** Compact score cell — fixed grid for teams/scores; status on the right */
function ScoreCell({ game, leagueSlug }: { game: ScoreRowType; leagueSlug: string }) {
  const statusLow = (game.status ?? "").toLowerCase();
  const isFinal = statusLow.includes("final");
  const isLive = !isFinal && (statusLow.includes("progress") || statusLow.includes("live"));
  const isScheduled = !isFinal && !isLive;

  const awayAbbr = fixedAwayAbbrCell(abbrevTeam(game.away_team));
  const homeAbbr = fixedHomeAbbrCell(abbrevTeam(game.home_team));
  const awayScr = fixedAwayScoreCell(game.away_score, isScheduled);
  const homeScr = fixedHomeScoreCell(game.home_score, isScheduled);

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors text-[10px] font-mono leading-tight tabular-nums">
      {/* Fixed 5-column scoreboard: away | away# | – | home# | home — always 3ch per team/score */}
      <div className="grid shrink-0 items-center gap-x-1 [grid-template-columns:3ch_3ch_1ch_3ch_3ch]">
        <Link
          href={`/sports/${leagueSlug}/${encodeURIComponent(game.away_team)}`}
          title={game.away_team}
          className="font-black text-right hover:underline whitespace-pre"
        >
          {awayAbbr}
        </Link>
        <span className="font-bold text-right whitespace-pre">{awayScr}</span>
        <span className="text-muted-foreground text-center text-[9px]">–</span>
        <span className="font-bold text-left whitespace-pre">{homeScr}</span>
        <Link
          href={`/sports/${leagueSlug}/${encodeURIComponent(game.home_team)}`}
          title={game.home_team}
          className="font-black text-left hover:underline whitespace-pre"
        >
          {homeAbbr}
        </Link>
      </div>
      {/* Spacer pushes status to the right */}
      <div className="flex-1 min-w-0" />
      {/* Status — dot always visible, label hidden on mobile */}
      {isFinal && (
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0" style={{ backgroundColor: "hsl(0 72% 50%)" }} />
          <span className="text-[8px] leading-none hidden sm:inline" style={{ color: "hsl(0 72% 50%)" }}>
            Final
          </span>
        </div>
      )}
      {isLive && (
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0" style={{ backgroundColor: "hsl(142 65% 42%)" }} />
          <span className="text-[8px] leading-none hidden sm:inline" style={{ color: "hsl(142 65% 42%)" }}>
            {game.status_detail ?? "Live"}
          </span>
        </div>
      )}
      {isScheduled && (
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0" style={{ backgroundColor: "hsl(220 10% 55%)" }} />
          <span className="text-[8px] leading-none text-muted-foreground hidden sm:inline">
            Sched
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Flat list of NYT article links.
 * showSection=true (NYT Today): show the section as a hub cap.
 * showSection=false (US / World): no hub cap — the card header already tells you the context.
 */
function NytList({ articles, showSection }: { articles: NyTimesArticle[]; showSection: boolean }) {
  return (
    <div>
      {articles.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
        >
          {showSection && a.section && <HubCap label={a.section} />}
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
    getLeagueSnapshot(supabase, "basketball", "mens-college-basketball"),
    getLeagueSnapshot(supabase, "football", "college-football"),
    getLeagueSnapshot(supabase, "basketball", "wnba"),
  ]);

  // ── NYT splits ────────────────────────────────────────────────────────────
  const NYT_US_SECTIONS  = new Set(["us", "politics", "nyregion", "national"]);
  const NYT_WORLD_SECTIONS = new Set(["world"]);

  const usStories    = nytAll.filter((a) => NYT_US_SECTIONS.has((a.section ?? "").toLowerCase()));
  const worldStories = nytAll.filter((a) => NYT_WORLD_SECTIONS.has((a.section ?? "").toLowerCase()));
  const otherStories = nytAll.filter(
    (a) =>
      !NYT_US_SECTIONS.has((a.section ?? "").toLowerCase()) &&
      !NYT_WORLD_SECTIONS.has((a.section ?? "").toLowerCase())
  );

  // ── NYT digest: one top story per section ────────────────────────────────
  const NYT_SECTION_ORDER: Record<string, number> = {
    us: 1, national: 2, politics: 3, nyregion: 4,
    world: 5, business: 6, technology: 7, science: 8,
    health: 9, arts: 10, opinion: 11, sports: 12,
    books: 13, food: 14, travel: 15, fashion: 16,
    style: 17, movies: 18, theater: 19, climate: 20,
    education: 21, briefing: 22, realestate: 23, automobiles: 24, obituaries: 25,
  };
  const nytBySectionMap = new Map<string, NyTimesArticle>();
  for (const a of nytAll) {
    const key = (a.section ?? "other").toLowerCase();
    if (!nytBySectionMap.has(key)) nytBySectionMap.set(key, a); // first = newest
  }
  const nytDigest = Array.from(nytBySectionMap.entries())
    .sort(([a], [b]) => (NYT_SECTION_ORDER[a] ?? 99) - (NYT_SECTION_ORDER[b] ?? 99));

  // ── Economic indicators grouped ───────────────────────────────────────────
  const econByGroup = econIndicators.reduce<Record<string, EconRow[]>>((acc, row) => {
    const cfg = ECON_CONFIG[row.indicator_name];
    const group = cfg?.group ?? "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(row);
    return acc;
  }, {});
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
      <MasonryColumns>

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
            <TickerGrid rows={assets.stocks} href="/markets" />
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
            <TickerGrid rows={assets.etfs} href="/markets" />
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
            <TickerGrid rows={assets.forex} href="/markets" />
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
            <TickerGrid rows={assets.commodities} href="/markets" />
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
            <div>
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
            <div>
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
                      className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                    >
                      {item.source && <HubCap label={item.source} />}
                      <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                        {item.headline}
                      </p>
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
          >
            <div>
              {companyNews.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  {item.source && <HubCap label={item.source} />}
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                      {item.headline}
                    </p>
                    {(item.related_tickers ?? []).length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-0.5">
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
                    )}
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
          >
            <div>
              {marketNews.map((item: any) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  {/* Two stacked hub caps: category on top, source below */}
                  <div className="flex flex-col gap-0.5 shrink-0 items-center">
                    {item.category && <HubCap label={item.category} />}
                    {item.source && <HubCap label={item.source} />}
                  </div>
                  <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                    {item.headline}
                  </p>
                </a>
              ))}
            </div>
          </CollapsibleCard>
        )}

        {/* ── NYT: digest card (top story per section) ──────────────────── */}

        {nytDigest.length > 0 && (
          <CollapsibleCard
            label="NYT — Top Stories"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={nytDigest.length}
            summary={`${nytDigest.length} sections`}
            contentHeight={newsCardHeight(nytDigest.length)}
          >
            <div>
              {nytDigest.map(([sectionKey, article]) => (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <HubCap label={sectionKey} />
                  <p className="text-[10px] font-semibold leading-tight line-clamp-1 group-hover:underline">
                    {article.title}
                  </p>
                </a>
              ))}
            </div>
          </CollapsibleCard>
        )}

        {/* ── NYT: grouped section cards ─────────────────────────────────── */}

        {usStories.length > 0 && (
          <CollapsibleCard
            label="Top Stories — US"
            accent="hsl(220 90% 52%)"
            href="/news"
            count={usStories.length}
            summary={`${usStories.length} articles`}
            contentHeight={newsCardHeight(usStories.length)}
            icon={<Flag size={9} />}
          >
            <NytList articles={usStories} showSection={false} />
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
            icon={<Globe size={9} />}
          >
            <NytList articles={worldStories} showSection={false} />
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
            <NytList articles={otherStories} showSection={true} />
          </CollapsibleCard>
        )}

        {/* ── Rows 4-5: Sports ──────────────────────────────────────────── */}

        {Object.entries(sportsSnapshots).map(([key, snapshot]) => {
          const snap = snapshot as LeagueSnapshot;
          if (!snap.league) return null;

          const hasScores = snap.recentGames.length > 0 || snap.upcomingGames.length > 0;
          const hasNews = snap.news.length > 0;
          if (!hasScores && !hasNews) return null;

          const offSeason = !snap.league.is_active;
          const totalGames = snap.recentGames.length + snap.upcomingGames.length;
          const sportsSummary =
            [
              totalGames > 0 && `${totalGames} games`,
              hasNews && `${snap.news.length} news`,
            ]
              .filter(Boolean)
              .join(" · ") || (offSeason ? "off season" : "no data");

          // All games combined for the 2-col grid (recent first, then upcoming)
          const allGames = [...snap.recentGames, ...snap.upcomingGames];
          const totalItems = allGames.length + snap.news.length;
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
              <div>
                {/* Scores section — 2-column game grid */}
                {(hasScores || offSeason) && (
                  <div>
                    {offSeason && (
                      <p className="px-2 py-1 text-[8px] font-mono text-muted-foreground uppercase tracking-widest border-b border-border">
                        Off season
                      </p>
                    )}
                    {hasScores && (
                      <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
                        {allGames.map((g, i) => (
                          <ScoreCell key={i} game={g} leagueSlug={snap.league!.league} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* News section */}
                {hasNews && (
                  <div>
                    {snap.news.map((n) => (
                      <a
                        key={n.id}
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 text-[10px] leading-tight hover:underline hover:bg-secondary/50 transition-colors"
                      >
                        <HubCap label={n.source ?? "ESPN"} />
                        <span className="line-clamp-2">{n.title}</span>
                      </a>
                    ))}
                  </div>
                )}

                {!hasScores && !hasNews && (
                  <p className="px-2 py-2 text-[9px] font-mono text-muted-foreground">No data</p>
                )}
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
          >
            <div>
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

      </MasonryColumns>
    </div>
  );
}
