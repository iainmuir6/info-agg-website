import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { DEFAULT_HOME_ORDER, type HomeSectionKey } from "@/lib/home-sections";
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
  // WNBA (official ESPN abbreviations)
  "Atlanta Dream": "ATL",
  "Chicago Sky": "CHI",
  "Connecticut Sun": "CONN",
  "Dallas Wings": "DAL",
  "Golden State Valkyries": "GS",
  "Indiana Fever": "IND",
  "Las Vegas Aces": "LV",
  "Los Angeles Sparks": "LA",
  "Minnesota Lynx": "MIN",
  "New York Liberty": "NY",
  "Phoenix Mercury": "PHX",
  "Seattle Storm": "SEA",
  "Washington Mystics": "WSH",
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
        .limit(10);
      if (data && data.length > 0) return data as CompanyNewsItem[];
    }
    const { data } = await supabase
      .from("company_news")
      .select("id, headline, url, source, published_at, related_tickers")
      .order("published_at", { ascending: false })
      .limit(10);
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
      .limit(10);
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

    if (!leagueRow) return { league: null, recentGames: [], upcomingGames: [], news: [] };

    const [scoresRes, newsRes] = await Promise.all([
      supabase
        .from("sports_scores")
        .select("event_id, home_team, away_team, home_abbrev, away_abbrev, home_score, away_score, status, status_detail, game_date")
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

/** One full-width score row: `AWY 3 – 7 HOM · status`. Winners bold, losers
 *  muted; scheduled games show tip-off time instead of dashes. */
function ScoreCell({ game, leagueSlug }: { game: ScoreRowType; leagueSlug: string }) {
  const statusLow = (game.status ?? "").toLowerCase();
  const isFinal = statusLow.includes("final");
  const isLive = !isFinal && (statusLow.includes("progress") || statusLow.includes("live"));
  const isScheduled = !isFinal && !isLive;

  // Prefer the official ESPN abbreviation stored with the score row
  const awayAbbr = (game.away_abbrev ?? abbrevTeam(game.away_team)).toUpperCase();
  const homeAbbr = (game.home_abbrev ?? abbrevTeam(game.home_team)).toUpperCase();

  const awayN = game.away_score != null ? Number(game.away_score) : null;
  const homeN = game.home_score != null ? Number(game.home_score) : null;
  const awayWon = isFinal && awayN != null && homeN != null && awayN > homeN;
  const homeWon = isFinal && awayN != null && homeN != null && homeN > awayN;
  const teamCls = (won: boolean) =>
    `font-black hover:underline ${isFinal && !won ? "text-muted-foreground" : ""}`;
  const scoreCls = (won: boolean) =>
    `font-bold tabular-nums ${isFinal && !won ? "text-muted-foreground" : ""}`;

  const tipOff =
    isScheduled && game.game_date
      ? new Date(game.game_date).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        })
      : null;

  // ESPN gamecast URL — soccer leagues (dotted slugs like eng.1) use /soccer/match/
  const espnUrl = game.event_id
    ? leagueSlug.includes(".")
      ? `https://www.espn.com/soccer/match/_/gameId/${game.event_id}`
      : `https://www.espn.com/${leagueSlug}/game/_/gameId/${game.event_id}`
    : null;

  return (
    <div className="relative flex items-center gap-1.5 px-1.5 py-1 border-b border-border hover:bg-secondary/50 transition-colors text-[9px] font-mono leading-tight">
      {/* Stretched link: the row body opens the ESPN game page; team links sit above it */}
      {espnUrl && (
        <a
          href={espnUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open game on ESPN"
          className="absolute inset-0"
        />
      )}
      <div className="grid shrink-0 items-center gap-x-1 [grid-template-columns:4ch_2.5ch_1ch_2.5ch_4ch]">
        <Link
          href={`/sports/${leagueSlug}/${encodeURIComponent(game.away_team)}`}
          title={game.away_team}
          className={`relative z-10 ${teamCls(awayWon)} text-left`}
        >
          {awayAbbr}
        </Link>
        <span className={`${scoreCls(awayWon)} text-right`}>
          {isScheduled ? "" : awayN ?? ""}
        </span>
        <span className="text-muted-foreground/60 text-center">{isScheduled ? "@" : "–"}</span>
        <span className={`${scoreCls(homeWon)} text-right`}>
          {isScheduled ? "" : homeN ?? ""}
        </span>
        <Link
          href={`/sports/${leagueSlug}/${encodeURIComponent(game.home_team)}`}
          title={game.home_team}
          className={`relative z-10 ${teamCls(homeWon)} text-left`}
        >
          {homeAbbr}
        </Link>
      </div>
      <div className="flex-1 min-w-0" />
      {isLive ? (
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0" style={{ backgroundColor: "hsl(142 65% 42%)" }} />
          <span className="text-[7px] leading-none" style={{ color: "hsl(142 65% 42%)" }}>
            {game.status_detail ?? "LIVE"}
          </span>
        </div>
      ) : (
        <span className="text-[7px] leading-none text-muted-foreground uppercase shrink-0">
          {isFinal ? "Final" : tipOff ?? "Sched"}
        </span>
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

  // ── NYT digest: one top story per section — the single NYT card.
  // (The former US / World / Today cards duplicated these articles.)
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
    .sort(([a], [b]) => (NYT_SECTION_ORDER[a] ?? 99) - (NYT_SECTION_ORDER[b] ?? 99))
    .slice(0, 12);

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

  // ── Personalization: section order + hidden sections ─────────────────────
  const { data: pageClaims } = await supabase.auth.getClaims();
  let userOrder: string[] | null = null;
  let hiddenSections: string[] = [];
  if (pageClaims?.claims) {
    const { data: prefs } = await supabase
      .from("user_home_prefs")
      .select("section_order, hidden_sections")
      .eq("user_id", pageClaims.claims.sub as string)
      .maybeSingle();
    userOrder = prefs?.section_order ?? null;
    hiddenSections = prefs?.hidden_sections ?? [];
  }

  // ── Card registry: every card is tagged with a section key so user prefs
  //    can reorder and hide sections. Default order interleaves markets /
  //    news / sports (DEFAULT_HOME_ORDER).
  const cards: { section: HomeSectionKey; node: React.ReactNode }[] = [];

  if (assets.stocks.length > 0) {
    cards.push({ section: "stocks", node: (
      <CollapsibleCard label="Stocks" accent="hsl(142 65% 42%)" href="/markets"
        count={assets.stocks.length} summary={`${assets.stocks.length} stocks`}>
        <TickerGrid rows={assets.stocks} href="/markets" />
      </CollapsibleCard>
    )});
  }

  if (nytDigest.length > 0) {
    cards.push({ section: "nyt", node: (
      <CollapsibleCard label="NYT — Top Stories" accent="hsl(220 90% 52%)" href="/news"
        count={nytDigest.length} summary={`${nytDigest.length} sections`}>
        <div>
          {nytDigest.map(([sectionKey, article]) => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              <HubCap label={sectionKey} />
              <p className="text-[10px] font-semibold leading-tight line-clamp-1 group-hover:underline">
                {article.title}
              </p>
            </a>
          ))}
        </div>
      </CollapsibleCard>
    )});
  }

  // Sports — one card per in-season league
  for (const [key, snapshot] of Object.entries(sportsSnapshots)) {
    const snap = snapshot as LeagueSnapshot;
    if (!snap.league) continue;

    // In-season gate: hide leagues with no games within ±10 days
    const IN_SEASON_WINDOW_MS = 10 * 24 * 3600 * 1000;
    const nowMs = Date.now();
    const inSeason = [...snap.recentGames, ...snap.upcomingGames].some((g) => {
      const t = g.game_date ? new Date(g.game_date).getTime() : NaN;
      return Number.isFinite(t) && Math.abs(nowMs - t) <= IN_SEASON_WINDOW_MS;
    });
    if (!inSeason) continue;

    const games = [...snap.recentGames.slice(0, 4), ...snap.upcomingGames.slice(0, 2)];
    const news = snap.news.slice(0, 3);
    const sportsSummary = [
      games.length > 0 && `${games.length} games`,
      news.length > 0 && `${news.length} news`,
    ].filter(Boolean).join(" · ");

    cards.push({ section: "sports", node: (
      <CollapsibleCard key={key}
        label={SPORTS_LABEL[key] ?? snap.league.display_name}
        accent="hsl(25 95% 50%)" href="/sports"
        count={games.length || undefined} summary={sportsSummary}
        headerExtra={
          <span className="text-[7px] font-mono leading-none px-1 py-0.5 rounded bg-secondary text-muted-foreground">
            ESPN
          </span>
        }>
        <div>
          {games.length > 0 && (
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 min-[380px]:divide-x divide-border border-b border-border">
              {games.map((g, i) => (
                <ScoreCell key={i} game={g} leagueSlug={snap.league!.league} />
              ))}
            </div>
          )}
          {news.length > 0 && (
            <div>
              {news.map((n) => (
                <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
                  className="block px-2 py-1 border-b border-border last:border-0 text-[10px] leading-tight hover:underline hover:bg-secondary/50 transition-colors">
                  <span className="line-clamp-2">{n.title}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </CollapsibleCard>
    )});
  }

  if (marketNews.length > 0) {
    cards.push({ section: "market_news", node: (
      <CollapsibleCard label="Market News" accent="hsl(142 65% 42%)" href="/markets"
        count={marketNews.length} summary={`${marketNews.length} articles`}>
        <div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {marketNews.map((item: any) => (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              {/* Two stacked hub caps: category on top, source below */}
              <div className="flex flex-col gap-0.5 shrink-0 items-center">
                {item.category && <HubCap label={item.category} />}
                {item.source && <HubCap label={item.source} />}
              </div>
              {/* Cell is two lines tall because of the stacked pills — let the
                  headline use both lines instead of truncating at one */}
              <p className="text-[10px] font-medium leading-tight line-clamp-2 group-hover:underline">
                {item.headline}
              </p>
            </a>
          ))}
        </div>
      </CollapsibleCard>
    )});
  }

  if (assets.etfs.length > 0) {
    cards.push({ section: "etfs", node: (
      <CollapsibleCard label="ETFs" accent="hsl(142 65% 42%)" href="/markets"
        count={assets.etfs.length} summary={`${assets.etfs.length} ETFs`}>
        <TickerGrid rows={assets.etfs} href="/markets" />
      </CollapsibleCard>
    )});
  }

  if (econIndicators.length > 0) {
    const yieldRows = econByGroup["Yield Curve"] ?? [];
    const macroRows = econByGroup["Macro"] ?? [];
    const otherRows = Object.entries(econByGroup).filter(([g]) => g !== "Yield Curve" && g !== "Macro");
    cards.push({ section: "econ", node: (
      <CollapsibleCard label="Economic Indicators" accent="hsl(142 65% 42%)" href="/economy"
        count={econIndicators.length} summary={`${econIndicators.length} indicators`}>
        <div>
          {yieldRows.length > 0 && (
            <div>
              <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border">
                Yield Curve
              </p>
              {/* One horizontal row: maturity above, rate below */}
              <div className="flex divide-x divide-border border-b border-border">
                {yieldRows.map((row) => (
                  <div key={row.indicator_name} className="flex-1 px-1 py-1 text-center min-w-0">
                    <p className="text-[8px] font-mono text-muted-foreground leading-none">
                      {ECON_CONFIG[row.indicator_name]?.label ?? row.indicator_name}
                    </p>
                    <p className="text-[10px] font-mono font-bold tabular-nums leading-tight mt-0.5">
                      {row.value.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {macroRows.length > 0 && (
            <div>
              <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border">
                Macro
              </p>
              {/* Two-column grid halves the vertical footprint */}
              <div className="grid grid-cols-2">
                {macroRows.map((row) => {
                  const cfg = ECON_CONFIG[row.indicator_name];
                  return (
                    <div key={row.indicator_name}
                      className="flex items-center justify-between gap-1 px-2 py-1 border-b border-r border-border min-w-0">
                      <span className="text-[9px] font-mono text-muted-foreground truncate">
                        {cfg?.label ?? row.indicator_name}
                      </span>
                      <span className="text-[9px] font-mono font-bold tabular-nums shrink-0">
                        {cfg ? cfg.fmt(row.value) : row.value.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {otherRows.map(([group, rows]) => (
            <div key={group}>
              <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border">
                {group}
              </p>
              <div className="grid grid-cols-2">
                {rows.map((row) => (
                  <div key={row.indicator_name}
                    className="flex items-center justify-between gap-1 px-2 py-1 border-b border-r border-border min-w-0">
                    <span className="text-[9px] font-mono text-muted-foreground truncate">{row.indicator_name}</span>
                    <span className="text-[9px] font-mono font-bold tabular-nums shrink-0">{row.value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>
    )});
  }

  if (companyNews.length > 0) {
    cards.push({ section: "stock_news", node: (
      <CollapsibleCard label="Stock News" accent="hsl(142 65% 42%)" href="/markets"
        count={companyNews.length} summary={`${companyNews.length} articles`}>
        <div>
          {companyNews.map((item) => (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              {item.source && <HubCap label={item.source} />}
              <div className="min-w-0">
                <p className="text-[10px] font-medium leading-tight line-clamp-1 group-hover:underline">
                  {item.headline}
                </p>
                {(item.related_tickers ?? []).length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                    {(item.related_tickers ?? []).slice(0, 3).map((t) => (
                      <Link key={t} href={`/markets/${t}`}
                        className="text-[8px] font-mono px-0.5 bg-secondary leading-none hover:bg-border">
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
    )});
  }

  if (hasCryptoQuotes || hasCryptoHeadlines) {
    cards.push({ section: "crypto", node: (
      <CollapsibleCard label="Crypto" accent="hsl(45 93% 47%)" href="/markets"
        count={hasCryptoQuotes ? assets.crypto.length : undefined}
        summary={`${assets.crypto.length} coins · ${cryptoHeadlines.length} headlines`}>
        <div>
          {hasCryptoQuotes && (
            <div className="border-b border-border">
              <TickerGrid rows={assets.crypto} href="/markets" />
            </div>
          )}
          {hasCryptoHeadlines && (
            <div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {cryptoHeadlines.map((item: any) => (
                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
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
    )});
  }

  if (assets.forex.length > 0) {
    cards.push({ section: "forex", node: (
      <CollapsibleCard label="FX" accent="hsl(142 65% 42%)" href="/markets"
        count={assets.forex.length} summary={`${assets.forex.length} pairs`}>
        <TickerGrid rows={assets.forex} href="/markets" />
      </CollapsibleCard>
    )});
  }

  if (assets.commodities.length > 0) {
    cards.push({ section: "commodities", node: (
      <CollapsibleCard label="Commodities" accent="hsl(45 93% 47%)" href="/markets"
        count={assets.commodities.length} summary={`${assets.commodities.length} commodities`}>
        <TickerGrid rows={assets.commodities} href="/markets" />
      </CollapsibleCard>
    )});
  }

  if (spotifyReleases.length > 0) {
    cards.push({ section: "spotify", node: (
      <CollapsibleCard label="Spotify" accent="hsl(340 78% 50%)" href="/media"
        count={spotifyReleases.length} summary={`${spotifyReleases.length} releases`}>
        <div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {spotifyReleases.slice(0, 8).map((r: any) => (
            <a key={r.id} href={r.external_url ?? "#"} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              <span className="text-[10px] shrink-0" style={{ color: "hsl(340 78% 50%)" }}>♫</span>
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
    )});
  }

  // Apply user prefs: hide, then stable-sort by section position
  const orderList =
    userOrder && userOrder.length > 0
      ? [
          ...userOrder.filter((k) => (DEFAULT_HOME_ORDER as string[]).includes(k)),
          ...DEFAULT_HOME_ORDER.filter((k) => !userOrder!.includes(k)),
        ]
      : (DEFAULT_HOME_ORDER as string[]);
  const sectionPos = new Map(orderList.map((k, i) => [k, i]));
  const visibleCards = cards
    .map((c, i) => ({ ...c, i }))
    .filter((c) => !hiddenSections.includes(c.section))
    .sort(
      (a, b) =>
        (sectionPos.get(a.section) ?? 99) - (sectionPos.get(b.section) ?? 99) || a.i - b.i
    );

  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      <MasonryColumns>
        {visibleCards.map((c, i) => (
          <Fragment key={`${c.section}-${i}`}>{c.node}</Fragment>
        ))}
      </MasonryColumns>
    </div>
  );
}
