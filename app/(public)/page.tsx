import { ThumbImage } from "@/components/thumb-image";
import { Fragment } from "react";
import { unstable_cache } from "next/cache";
import { getShowImages } from "@/lib/spotify-search";
import { createClient } from "@/lib/supabase/server";
import { getMiscContent } from "@/lib/misc-content";
import { getAiSummaries } from "@/lib/ai-summary";
import {
  AI_ACCENT,
  DaySummaryMini,
  WeekSummaryMini,
} from "@/components/ai-summary-cards";
import {
  AlmanacMini,
  CalendarMini,
  CountryMini,
  MISC_ACCENT,
  OnThisDayMini,
  WeatherGridMini,
} from "@/components/misc-cards";
import Link from "next/link";
import { DEFAULT_HOME_ORDER, SECTION_DOMAIN, type HomeSectionKey } from "@/lib/home-sections";
import { TickerHoverChart } from "@/components/ticker-hover-chart";
import { compactStatus, formatGameTime, isGameToday, formatGameDateShort, leadingDaySlate } from "@/lib/sports-status";
import { latestSeasonOnly, groupStandings, topNPerGroupWithFavorites, type StandingRow, type StandingsGroup } from "@/lib/standings";
import { StandingsExpander } from "@/components/standings-expander";
import {
  SPOTIFY_HOME_PLAYLISTS,
  SPOTIFY_EMBED_ALLOW,
  SPOTIFY_EMBED_CLASS,
  spotifyPlaylistEmbedUrl,
} from "@/lib/top-podcasts";
import { buildPodcastList, type FavoritedPodcastRow } from "@/lib/podcast-list";
import { FavoritePodcastButton } from "@/components/favorite-podcast-button";
import {
  getFavorites,
  gameIsFavorite,
  teamIsFavorite,
  favoriteTeamNamesForLeague,
  capKeepingFavorites,
  favoritesFirst,
  byDayThenFavorites,
  NO_FAVORITES,
  type Favorites,
} from "@/lib/favorites";
import { CollapsibleCard } from "@/components/collapsible-card";
import { CommandCenterCards, type CardMeta } from "@/components/command-center-cards";
import type { PackHint } from "@/components/masonry-columns";
import { forexPairName } from "@/lib/currencies";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteRow = {
  ticker: string;
  name?: string | null;
  asset_type: string;
  market_cap: number | null;
  // All the DECIMAL columns on stock_quotes are nullable (supabase/02_tables.sql),
  // and the consumers below already guard with `?? 0` / `!= null` — the type was
  // the only thing claiming otherwise.
  quote: { current_price: number | null; percent_change: number | null } | null;
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
  home_logo: string | null;
  away_logo: string | null;
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
  standings: StandingsGroup[];
};

type EconRow = {
  indicator_name: string;
  date: string;
  value: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

// Friendly labels + formatting for economic indicators
const ECON_CONFIG: Record<string, { label: string; fmt: (v: number) => string; group: string }> = {
  treasury_1m:  { label: "1M",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Treasuries" },
  treasury_3m:  { label: "3M",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Treasuries" },
  treasury_6m:  { label: "6M",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Treasuries" },
  treasury_7y:  { label: "7Y",            fmt: (v) => `${v.toFixed(2)}%`,  group: "Treasuries" },
  treasury_20y: { label: "20Y",           fmt: (v) => `${v.toFixed(2)}%`,  group: "Treasuries" },
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

// ETF sub-groups — mirrors src/api/markets/baskets.json's core_market/breadth/
// sectors/risk baskets, which never reach the DB (only the coarse `asset_type`
// does — see classify_tickers() in run_etl.py). Keep in sync manually if
// baskets.json's ETF tickers change.
const ETF_GROUP_BY_TICKER: Record<string, string> = {
  // core_market + breadth: broad index & factor/style funds
  VTI: "Macro/Market", SPY: "Macro/Market", QQQ: "Macro/Market", IWM: "Macro/Market", VXUS: "Macro/Market",
  RSP: "Macro/Market", VUG: "Macro/Market", VTV: "Macro/Market",
  // sectors: SPDR sector funds
  XLC: "Sectors", XLY: "Sectors", XLP: "Sectors", XLE: "Sectors", XLF: "Sectors",
  XLV: "Sectors", XLI: "Sectors", XLB: "Sectors", XLRE: "Sectors", XLK: "Sectors", XLU: "Sectors",
  // risk: rates/credit/dollar vs. commodities — split so "Commodities" means what it says
  TLT: "Rates & Currency", HYG: "Rates & Currency", UUP: "Rates & Currency",
  GLD: "Commodities", SLV: "Commodities", DBC: "Commodities",
};
const ETF_GROUP_ORDER = ["Macro/Market", "Sectors", "Rates & Currency", "Commodities"];

// Within "Macro/Market", surface the big three index funds first.
const ETF_TICKER_PRIORITY: Record<string, number> = { VTI: 0, SPY: 1, QQQ: 2 };

// Stocks panel — mega-cap tech first, in this exact order; everything else
// falls in after, alphabetically.
const STOCK_TICKER_PRIORITY: Record<string, number> = {
  META: 0, NVDA: 1, GOOGL: 2, SPCX: 3, AAPL: 4, MSFT: 5, TSLA: 6, AMD: 7, INTC: 8,
};

// Hidden from the homepage panel only — still tracked/queryable everywhere
// else (e.g. /markets). Remove a ticker here to bring it back.
const HOME_HIDDEN_STOCKS = new Set(["AVGO"]);

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

/** A core stocks row with its embedded quotes, as PostgREST returns it.
 *  market_cap is a BIGINT, which comes back as a string to avoid precision
 *  loss above 2^53 — see the normalisation in the mapper below. */
type CoreAssetRow = {
  ticker: string;
  name: string | null;
  asset_type: string | null;
  market_cap: string | number | null;
  stock_quotes: {
    current_price: number | null;
    percent_change: number | null;
    quote_timestamp: string;
  }[] | null;
};


/** Rough rendered height of a card, used only to balance the masonry columns.
 *
 *  Read off each card's own `count` prop rather than threading a weight
 *  through ~20 push sites. The numbers are deliberately coarse — they decide
 *  which column a card lands in, nothing else, so being 20px out is harmless
 *  while being 200px out (a 12-row news list treated like a 3-row grid) is
 *  what left the last column nearly empty.
 */
const CARD_HEADER_PX = 30;

function estimateCardHeight(section: HomeSectionKey, count: number): number {
  switch (section) {
    // Ticker grids lay out 3 across, so N tickers is only ceil(N/3) rows.
    case "stocks":
      return CARD_HEADER_PX + Math.ceil(count / 2) * 30; // `large`, 2 columns
    case "forex":
    case "commodities":
      return CARD_HEADER_PX + Math.ceil(count / 3) * 28;
    // ETFs are the same grid but split into four labelled groups (macro,
    // sectors, rates, commodities), and those headers are not in `count`.
    case "etfs":
      return CARD_HEADER_PX + Math.ceil(count / 3) * 28 + 70;
    // Crypto is a ticker grid PLUS a headline list that `count` says nothing
    // about — measured 242px against the 58px the bare grid would suggest.
    case "crypto":
      return CARD_HEADER_PX + Math.ceil(count / 3) * 28 + 180;
    case "econ":
      return CARD_HEADER_PX + Math.ceil(count / 2) * 22 + 60; // grouped headers
    // Stacked lists of wrapping headlines.
    case "nyt":
    case "nyt_more":
    case "market_news":
    case "stock_news":
      return CARD_HEADER_PX + count * 32;
    case "youtube":
      return CARD_HEADER_PX + Math.min(count, 8) * 30;
    case "podcasts":
      return CARD_HEADER_PX + count * 27;
    case "spotify":
      return 240; // fixed-height iframe embeds
    // Score rows lay out TWO-UP (.score-grid in globals.css), so N games is
    // ceil(N/2) rows — not N. Treating them as one-up made the 27-game MLB
    // card estimate 1,038px against a measured 476px, and the packer left a
    // whole column short to make room for it.
    case "sports":
      return CARD_HEADER_PX + Math.ceil(count / 2) * 29 + 90; // + standings
    case "weather":
      return CARD_HEADER_PX + 96; // fixed 2x3 grid
    case "country":
      return CARD_HEADER_PX + 115 + 24 + 3 * 34; // map + flag + 3 fact rows
    case "onthisday":
      return CARD_HEADER_PX + Math.min(count, 5) * 34;
    case "calendar":
      return CARD_HEADER_PX + Math.min(count, 5) * 32;
    case "almanac":
      return CARD_HEADER_PX + count * 30;
    // Briefings. Calibrated against the rendered cards rather than guessed:
    // measured in the browser at 520px (7 rows) and 773px (20 units), against
    // original estimates of 328 and 504. Under-estimating these by ~55% made
    // the packer treat the briefing column as far emptier than it was and
    // pile five more cards into it.
    case "ai_day":
      // header + serif headline + two section rules + 3-line rows + footer
      return CARD_HEADER_PX + 110 + count * 52;
    case "ai_week":
      // header + serif headline + footer; `count` is bullets + domain pills
      return CARD_HEADER_PX + 58 + count * 34;
    default:
      return CARD_HEADER_PX + count * 30;
  }
}

async function getCoreAssetsByType(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("stocks")
      .select("ticker, name, asset_type, market_cap, stock_quotes(current_price, percent_change, quote_timestamp)")
      .eq("is_core", true)
      .eq("is_active", true);

    const withQuote = ((data ?? []) as CoreAssetRow[])
      .map((s) => {
        // Sort by quote_timestamp (what trading day/moment the quote is
        // FOR), not fetched_at (when we happened to pull it) — a historical
        // backfill run after today's live quote stamps every backfilled row
        // with a fresher fetched_at than the live quote, which would
        // otherwise make an old closing price outrank the real current one.
        const quotes = (s.stock_quotes ?? []).sort(
          (a, b) =>
            new Date(b.quote_timestamp).getTime() - new Date(a.quote_timestamp).getTime()
        );
        return {
          ticker: s.ticker as string,
          name: s.name as string | null,
          asset_type: (s.asset_type as string) ?? "stock",
          // BIGINT comes back from PostgREST as a string to avoid precision
          // loss above 2^53 — normalize to number for the weighted-avg math.
          market_cap: s.market_cap != null ? Number(s.market_cap) : null,
          quote: quotes[0]
            ? { current_price: quotes[0].current_price, percent_change: quotes[0].percent_change }
            : null,
        } satisfies QuoteRow;
      })
      .filter((r) => r.quote !== null);

    const byType = (type: string) =>
      withQuote
        .filter((r) => r.asset_type === type)
        .filter((r) => !(type === "stock" && HOME_HIDDEN_STOCKS.has(r.ticker)))
        .sort((a, b) => {
          if (type === "stock") {
            const pa = STOCK_TICKER_PRIORITY[a.ticker] ?? 99;
            const pb = STOCK_TICKER_PRIORITY[b.ticker] ?? 99;
            if (pa !== pb) return pa - pb;
          }
          return a.ticker.localeCompare(b.ticker);
        });

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

// Cover art for the podcast card. Spotify is not part of the ETL, so this is
// cached here rather than stored: one call covers the whole list, and the
// artwork changes far less often than the daily cache window.
const getPodcastImages = unstable_cache(
  async (ids: string[]) => getShowImages(ids),
  ["podcast-images"],
  { revalidate: 86400 },
);

async function getYouTubeVideos(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("youtube_videos")
      .select("id, video_id, title, channel_title, view_count, thumbnail_url")
      .order("view_count", { ascending: false })
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
  // Headroom for one full day's slate per side, not the number displayed. MLB
  // plays ~16 games a day (more with doubleheaders), so the old limit of 6
  // couldn't even load a single day: a favorite team's game sitting 8th most
  // recent never reached the page, and no amount of sorting could surface it.
  scoreLimit = 40,
  newsLimit = 4
): Promise<LeagueSnapshot> {
  try {
    const { data: leagueRow } = await supabase
      .from("leagues")
      .select("id, sport, league, display_name, is_active")
      .eq("sport", sport)
      .eq("league", league)
      .single();

    if (!leagueRow) return { league: null, recentGames: [], upcomingGames: [], news: [], standings: [] };

    // Two windowed queries rather than one "latest N by game_date".
    // Unwindowed, the newest rows are the furthest-FUTURE fixtures — once the
    // season backfill loaded full schedules, every league's top rows were
    // weeks out, so recentGames came back empty and the in-season check
    // rejected every card. Anchoring each side on now() is immune to how much
    // future schedule the table holds.
    const SCORE_COLS =
      "event_id, home_team, away_team, home_abbrev, away_abbrev, home_logo, away_logo, home_score, away_score, status, status_detail, game_date";
    const nowIso = new Date().toISOString();

    const STANDING_COLS =
      "team_name, team_abbrev, logo, conference, division, wins, losses, ties, win_percent, games_behind, streak, playoff_seed, point_differential, points, rank, season";

    const [recentRes, upcomingRes, newsRes, standingsRes] = await Promise.all([
      supabase
        .from("sports_scores")
        .select(SCORE_COLS)
        .eq("league_id", leagueRow.id)
        .lte("game_date", nowIso)
        .order("game_date", { ascending: false })
        .limit(scoreLimit),
      supabase
        .from("sports_scores")
        .select(SCORE_COLS)
        .eq("league_id", leagueRow.id)
        .gt("game_date", nowIso)
        .order("game_date", { ascending: true })
        .limit(scoreLimit),
      supabase
        .from("sports_news")
        .select("id, title, url, published_at, source")
        .eq("league_id", leagueRow.id)
        .order("published_at", { ascending: false })
        .limit(newsLimit),
      supabase
        .from("sports_standings")
        .select(STANDING_COLS)
        .eq("league_id", leagueRow.id),
    ]);

    // A live game has a start time in the past, so it lands in recentGames.
    const recentGames = (recentRes.data ?? []) as ScoreRowType[];
    const upcomingGames = (upcomingRes.data ?? []) as ScoreRowType[];
    const news = (newsRes.data ?? []) as SportsNewsItem[];
    // Full groups, not yet capped to top N — this snapshot is fetched before
    // the user's favorites are known (see below), and truncating here would
    // permanently drop a followed team that sits outside a large league's
    // (e.g. NCAAF's) top-N-per-conference cut. Capping happens at render time
    // via `topNPerGroupWithFavorites`, once `favorites` is available.
    const standings = groupStandings(latestSeasonOnly((standingsRes.data ?? []) as StandingRow[]));

    return {
      league: leagueRow as LeagueRow,
      recentGames: leagueRow.is_active ? recentGames : [],
      upcomingGames: leagueRow.is_active ? upcomingGames : [],
      news,
      standings: leagueRow.is_active ? standings : [],
    };
  } catch {
    return { league: null, recentGames: [], upcomingGames: [], news: [], standings: [] };
  }
}

// ─── Helper components ────────────────────────────────────────────────────────

function ChangeTag({ pct, large }: { pct: number; large?: boolean }) {
  const isPos = pct >= 0;
  return (
    <span
      className={`font-mono font-bold tabular-nums leading-none ${large ? "text-[11px]" : "text-[10px]"}`}
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
  // ── League slugs (ESPN's own, all > 8 chars) ──────────────────────────────
  "college-football":         "NCAAF",  // 16 chars
  "mens-college-basketball":  "NCAAM",  // 23 chars
  "womens-college-basketball":"NCAAW",  // 25 chars
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

/** Market-cap-weighted average %-change across a group of tickers — a proxy
 *  for AUM-weighting since ETF net assets aren't tracked, just FMP's profile
 *  market_cap. Returns null when nothing in the group has both a cap and a
 *  quote, so callers can skip rendering the summary cell entirely. */
function weightedAvgPercent(rows: QuoteRow[]): number | null {
  const weighted = rows.filter((r) => r.market_cap != null && r.quote?.percent_change != null);
  const totalWeight = weighted.reduce((sum, r) => sum + (r.market_cap ?? 0), 0);
  if (totalWeight <= 0) return null;
  const weightedSum = weighted.reduce(
    (sum, r) => sum + (r.market_cap ?? 0) * Number(r.quote!.percent_change),
    0,
  );
  return weightedSum / totalWeight;
}

/** Background for the weighted-avg summary cell: hue signals direction, and
 *  lightness scales with magnitude (capped at +/-3% for full saturation) so
 *  bigger moves read as visibly stronger color. White text stays legible
 *  across the whole range since lightness never climbs above ~46%. */
function weightedChangeColors(pct: number): { bg: string; text: string } {
  // True diverging scale: red -> white -> green, not just two independent
  // hues. Fix hue per sign and pull saturation/lightness toward white as
  // magnitude shrinks. Full color hits at +/-2% (a market day rarely moves
  // more than that), and a sqrt curve — rather than linear — front-loads the
  // ramp so a modest 0.5% move already reads as clearly colored instead of
  // barely-tinted.
  const raw = Math.min(Math.abs(pct), 2) / 2;
  const magnitude = Math.sqrt(raw);
  const hue = pct >= 0 ? 142 : 0;
  const maxSat = pct >= 0 ? 65 : 72;
  const baseLightness = pct >= 0 ? 42 : 45;
  const saturation = maxSat * magnitude;
  const lightness = 100 - (100 - baseLightness) * magnitude;
  // Near white, white text disappears — flip to dark text once the
  // background gets light enough that white would lose contrast.
  const text = lightness > 65 ? "hsl(0 0% 20%)" : "#fff";
  return { bg: `hsl(${hue} ${saturation}% ${lightness}%)`, text };
}

/** Summary tile for a TickerGrid group — same cell footprint as a ticker
 *  cell, but a solid color-scaled background instead of the usual badge. */
function WeightedAvgCell({ label, pct }: { label: string; pct: number }) {
  const { bg, text } = weightedChangeColors(pct);
  return (
    <div
      className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 border-b border-r border-border"
      style={{ backgroundColor: bg }}
      title={`${label} — market-cap-weighted average change`}
    >
      <span className="text-[7px] font-mono uppercase tracking-wider leading-none" style={{ color: text, opacity: 0.8 }}>
        Avg
      </span>
      <span className="text-[10px] font-mono font-black tabular-nums leading-none" style={{ color: text }}>
        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

/** Ticker 3-column grid — used for stocks, etfs, forex, commodities, crypto quotes */
function TickerGrid({
  rows, href, leadCell, columns = 3, large = false, favoriteTickers,
}: {
  rows: QuoteRow[]; href: string; leadCell?: React.ReactNode; columns?: 2 | 3; large?: boolean;
  /** Favorited tickers float to the top and get the faint gold ring */
  favoriteTickers?: Set<string>;
}) {
  const ordered = favoriteTickers?.size
    ? favoritesFirst(rows, (s) => favoriteTickers.has(s.ticker.toUpperCase()))
    : rows;
  return (
    <div className={columns === 2 ? "grid grid-cols-2" : "grid grid-cols-3"}>
      {leadCell}
      {ordered.map((s) => {
        const pct = parseFloat(String(s.quote?.percent_change ?? 0));
        const price = parseFloat(String(s.quote?.current_price ?? 0));
        const favorite = !!favoriteTickers?.has(s.ticker.toUpperCase());
        // Forex is stored USD-base, so "USDJPY" is 1 USD in yen. The USD leg
        // is the same on every row, so the label drops it and the value takes
        // no dollar sign — it is not a dollar amount. Rates below 10 need more
        // than 2 decimals to move at all (USDEUR ~0.8628).
        const isFx = s.asset_type === "forex";
        const label = isFx && s.ticker.startsWith("USD") ? s.ticker.slice(3) : s.ticker;
        const hoverName = isFx ? forexPairName(s.ticker) : undefined;
        const value = isFx
          ? price.toFixed(price >= 10 ? 2 : 4)
          : `$${price.toFixed(2)}`;
        return (
          <TickerHoverChart
            key={s.ticker}
            ticker={s.ticker}
            displayName={hoverName}
            currency={!isFx}
            href={href.startsWith("/sports") ? href : `/markets/${s.ticker}`}
            wrapperClassName="block min-w-0"
            className={`flex items-center justify-between gap-1 border-b border-r border-border hover:bg-secondary/50 transition-colors group ${large ? "px-2.5 py-1.5" : "px-2 py-1"}${favorite ? " favorite-cell" : ""}`}
          >
            <span className={`font-mono font-black shrink-0 group-hover:underline ${large ? "text-xs" : "text-[10px]"}`}>
              {label}
            </span>
            <span className="flex flex-col items-end shrink-0 min-w-0">
              <span className={`font-mono tabular-nums font-bold leading-none ${large ? "text-[11px]" : "text-[9px]"}`}>
                {value}
              </span>
              <ChangeTag pct={pct} large={large} />
            </span>
          </TickerHoverChart>
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
function ScoreCell({
  game,
  leagueSlug,
  favorite = false,
}: {
  game: ScoreRowType;
  leagueSlug: string;
  /** Either side is a favorite team — gets the faint gold ring */
  favorite?: boolean;
}) {
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

  const tipOff = isScheduled && game.game_date ? formatGameTime(game.game_date) : null;
  const showDate = isScheduled && game.game_date && !isGameToday(game.game_date);
  const gameDate = showDate ? formatGameDateShort(game.game_date) : null;

  const liveStatus = compactStatus(game.status_detail);

  // ESPN gamecast URL — soccer leagues (dotted slugs like eng.1) use /soccer/match/
  const espnUrl = game.event_id
    ? leagueSlug.includes(".")
      ? `https://www.espn.com/soccer/match/_/gameId/${game.event_id}`
      : `https://www.espn.com/${leagueSlug}/game/_/gameId/${game.event_id}`
    : null;

  return (
    /* One grid across the whole row so the container allocates the width.
       `.score-row` sizes this row's font as a fraction of its own (fixed)
       width — every other length below is `em`, so the entire row scales as
       a rigid shape and is guaranteed to fit without truncating, scrolling,
       or ever dropping to one column. See `.score-row` in globals.css. */
    <div className={`score-row tap-row relative grid items-center gap-x-[0.89em] md:gap-x-[0.22em] px-[0.67em] py-[0.67em] border-b border-border hover:bg-secondary/50 transition-colors font-mono leading-tight whitespace-nowrap [grid-template-columns:minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)_auto]${favorite ? " favorite-cell" : ""}`}>
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
      <Link
        href={`/${leagueSlug}/${awayAbbr}`}
        title={game.away_team}
        className={`relative z-10 flex items-center justify-end gap-[0.44em] ${teamCls(awayWon)} text-right`}
      >
        {game.away_logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.away_logo} alt="" className="w-[1.33em] h-[1.33em] shrink-0 object-contain" />
        )}
        <span>{awayAbbr}</span>
      </Link>
      <span className={`${scoreCls(awayWon)} text-right tabular-nums`}>
        {isScheduled ? "" : awayN ?? ""}
      </span>
      <span className="text-[0.78em] text-muted-foreground/50 text-center px-0">{isScheduled ? "@" : "–"}</span>
      <span className={`${scoreCls(homeWon)} text-left tabular-nums`}>
        {isScheduled ? "" : homeN ?? ""}
      </span>
      <Link
        href={`/${leagueSlug}/${homeAbbr}`}
        title={game.home_team}
        className={`relative z-10 flex items-center justify-start gap-[0.44em] ${teamCls(homeWon)} text-left`}
      >
        <span>{homeAbbr}</span>
        {game.home_logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.home_logo} alt="" className="w-[1.33em] h-[1.33em] shrink-0 object-contain" />
        )}
      </Link>
      {isLive ? (
        /* Two short lines instead of one truncated one: "1:21 - 1st Quarter"
           reads as 1:21 / 1st rather than being clipped to "1:21 -". */
        <span
          className="flex flex-col items-end justify-center leading-none text-[0.78em]"
          style={{ color: "hsl(142 65% 42%)" }}
          title={game.status_detail ?? "Live"}
        >
          <span>{liveStatus.top}</span>
          {liveStatus.bottom && <span>{liveStatus.bottom}</span>}
        </span>
      ) : gameDate ? (
        /* Not today — stack the date above the time instead of cramming
           both into one line. */
        <span
          className="flex flex-col items-end justify-center leading-none text-[0.78em] text-muted-foreground uppercase"
          title={`${gameDate} ${tipOff ?? ""}`.trim()}
        >
          <span>{gameDate}</span>
          <span>{tipOff}</span>
        </span>
      ) : (
        <span className="text-[0.89em] leading-none text-muted-foreground uppercase text-right">
          {isFinal ? "Final" : tipOff ?? "Sched"}
        </span>
      )}
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
    youtubeVideos,
    econIndicators,
    misc,
    aiSummaries,
    nba, mlb, nfl, nhl, ncaab, ncaaf, wnba,
  ] = await Promise.all([
    getCompanyNews(supabase, assets.coreTickers),
    getCryptoHeadlines(supabase),
    getMarketNews(supabase),
    getAllNyt(supabase),
    getYouTubeVideos(supabase),
    getEconomicIndicators(supabase),
    getMiscContent(supabase),
    getAiSummaries(supabase),
    getLeagueSnapshot(supabase, "basketball", "nba"),
    getLeagueSnapshot(supabase, "baseball", "mlb"),
    getLeagueSnapshot(supabase, "football", "nfl"),
    getLeagueSnapshot(supabase, "hockey", "nhl"),
    // College leagues run 60-80+ games on their busiest single day (a full
    // FBS/FCS Saturday, a loaded November D1 slate) — the default 40-row
    // headroom didn't even cover that one day, let alone reach back far
    // enough for a favorited team's game on a lighter day (e.g. Friday CFB)
    // to survive the fetch at all.
    getLeagueSnapshot(supabase, "basketball", "mens-college-basketball", 100),
    getLeagueSnapshot(supabase, "football", "college-football", 100),
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

  // Second NYT panel: the next-best stories the digest didn't surface —
  // one story per section is a thin slice of a busy news day, so this shows
  // the runner-up headlines from the highest-signal sections.
  const digestUrls = new Set(nytDigest.map(([, a]) => a.url));
  const NYT_DEEP_SECTIONS = new Set(["us", "world", "business", "technology", "politics", "science", "opinion"]);
  const nytMore = nytAll
    .filter((a) => !digestUrls.has(a.url) && NYT_DEEP_SECTIONS.has((a.section ?? "").toLowerCase()))
    .slice(0, 10);

  // ── Economic indicators grouped ───────────────────────────────────────────
  const econByGroup = econIndicators.reduce<Record<string, EconRow[]>>((acc, row) => {
    const cfg = ECON_CONFIG[row.indicator_name];
    const group = cfg?.group ?? "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(row);
    return acc;
  }, {});
  const TREASURY_ORDER = ["treasury_1m","treasury_3m","treasury_6m","treasury_1y","treasury_2y","treasury_3y","treasury_5y","treasury_7y","treasury_10y","treasury_20y","treasury_30y"];
  if (econByGroup["Treasuries"]) {
    econByGroup["Treasuries"].sort(
      (a, b) => TREASURY_ORDER.indexOf(a.indicator_name) - TREASURY_ORDER.indexOf(b.indicator_name),
    );
  }
  if (econByGroup["Yield Curve"]) {
    econByGroup["Yield Curve"].sort(
      (a, b) => TREASURY_ORDER.indexOf(a.indicator_name) - TREASURY_ORDER.indexOf(b.indicator_name)
    );
  }

  // ── ETFs grouped ───────────────────────────────────────────────────────────
  const etfsByGroup = assets.etfs.reduce<Record<string, QuoteRow[]>>((acc, row) => {
    const group = ETF_GROUP_BY_TICKER[row.ticker] ?? "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(row);
    return acc;
  }, {});
  if (etfsByGroup["Macro/Market"]) {
    etfsByGroup["Macro/Market"].sort((a, b) => {
      const pa = ETF_TICKER_PRIORITY[a.ticker] ?? 99;
      const pb = ETF_TICKER_PRIORITY[b.ticker] ?? 99;
      return pa !== pb ? pa - pb : a.ticker.localeCompare(b.ticker);
    });
  }

  // ── Crypto combined ───────────────────────────────────────────────────────
  const hasCryptoQuotes = assets.crypto.length > 0;
  const hasCryptoHeadlines = cryptoHeadlines.length > 0;

  // ── Sports ────────────────────────────────────────────────────────────────
  const SPORTS_LABEL: Record<string, string> = {
    nba: "NBA", mlb: "MLB", nfl: "NFL", nhl: "NHL",
    ncaab: "NCAAB", ncaaf: "NCAAF", wnba: "WNBA",
  };
  // Key order drives card order — the leagues are rendered by iterating this.
  const sportsSnapshots: Record<string, LeagueSnapshot> = {
    nfl, nba, ncaaf, ncaab, mlb, nhl, wnba,
  };

  // ── Personalization: section order + hidden sections ─────────────────────
  const { data: pageClaims } = await supabase.auth.getClaims();
  const signedIn = !!pageClaims?.claims;
  let userOrder: string[] | null = null;
  let hiddenSections: string[] = [];
  let favoritePodcastRows: FavoritedPodcastRow[] = [];
  let favorites: Favorites = NO_FAVORITES;
  if (pageClaims?.claims) {
    const userId = pageClaims.claims.sub as string;
    const [prefsRes, favoritePodcastsRes, favoritesRes] = await Promise.all([
      supabase
        .from("user_home_prefs")
        .select("section_order, hidden_sections")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("watchlist_podcasts").select("show_id, name, image_url").eq("user_id", userId),
      getFavorites(supabase, userId),
    ]);
    userOrder = prefsRes.data?.section_order ?? null;
    hiddenSections = prefsRes.data?.hidden_sections ?? [];
    favoritePodcastRows = favoritePodcastsRes.data ?? [];
    favorites = favoritesRes;
  }

  // ── Card registry: every card is tagged with a section key so user prefs
  //    can reorder and hide sections. Default order interleaves markets /
  //    news / sports (DEFAULT_HOME_ORDER).
  const cards: { section: HomeSectionKey; node: React.ReactNode }[] = [];

  // /summary is reached ONLY from these two cards — it is not in NAV_LINKS.
  // The compact rows clamp their text; the page carries it in full.
  if (aiSummaries.day) {
    const dayRows = aiSummaries.day.yesterday.length + aiSummaries.day.today.length;
    cards.push({ section: "ai_day", node: (
      <CollapsibleCard label="Summary of the Day" accent={AI_ACCENT} href="/summary" count={dayRows}>
        <DaySummaryMini summary={aiSummaries.day} />
      </CollapsibleCard>
    )});
  }

  if (aiSummaries.week) {
    const weekRows = aiSummaries.week.sections.reduce(
      (n, s) => n + s.bullets.length + 1,
      0,
    );
    cards.push({ section: "ai_week", node: (
      <CollapsibleCard label="Summary of the Week" accent={AI_ACCENT} href="/summary" count={weekRows}>
        <WeekSummaryMini summary={aiSummaries.week} />
      </CollapsibleCard>
    )});
  }

  if (assets.stocks.length > 0) {
    cards.push({ section: "stocks", node: (
      <CollapsibleCard label="Stocks" accent="hsl(142 65% 42%)" href="/markets"
        count={assets.stocks.length} summary={`${assets.stocks.length} stocks`}>
        <TickerGrid rows={assets.stocks} href="/markets" columns={2} large favoriteTickers={favorites.tickers} />
      </CollapsibleCard>
    )});
  }

  if (misc.weather.length > 0) {
    cards.push({ section: "weather", node: (
      <CollapsibleCard label="Weather" accent={MISC_ACCENT} href="/misc"
        count={misc.weather.length} summary={`${misc.weather.length} cities`}>
        <WeatherGridMini cities={misc.weather} />
      </CollapsibleCard>
    )});
  }

  if (misc.holidays.length > 0) {
    cards.push({ section: "calendar", node: (
      <CollapsibleCard label="Calendar" accent={MISC_ACCENT} href="/misc"
        count={misc.holidays.length} summary={`${misc.holidays.length} upcoming`}>
        <CalendarMini holidays={misc.holidays} />
      </CollapsibleCard>
    )});
  }

  if (misc.country) {
    cards.push({ section: "country", node: (
      <CollapsibleCard label="Country of the Day" accent={MISC_ACCENT} href="/misc"
        summary={misc.country.name_common ?? undefined}>
        <CountryMini country={misc.country} />
      </CollapsibleCard>
    )});
  }

  if (misc.onThisDay.length > 0) {
    cards.push({ section: "onthisday", node: (
      <CollapsibleCard label="On This Day" accent={MISC_ACCENT} href="/misc"
        count={Math.min(misc.onThisDay.length, 5)}>
        <OnThisDayMini events={misc.onThisDay} />
      </CollapsibleCard>
    )});
  }

  if (misc.word || misc.wikipedia.length > 0 || misc.facts.length > 0) {
    const almanacCount =
      (misc.word ? 1 : 0) + misc.wikipedia.length + misc.facts.length;
    cards.push({ section: "almanac", node: (
      <CollapsibleCard label="Misc" accent={MISC_ACCENT} href="/misc"
        count={almanacCount}>
        <AlmanacMini word={misc.word} pages={misc.wikipedia} facts={misc.facts} />
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
              className="tap-row flex items-center min-h-[30px] gap-1.5 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              <HubCap label={sectionKey} />
              <p className="text-[10px] font-semibold leading-tight line-clamp-2 group-hover:underline">
                {article.title}
              </p>
            </a>
          ))}
        </div>
      </CollapsibleCard>
    )});
  }

  if (nytMore.length > 0) {
    cards.push({ section: "nyt_more", node: (
      <CollapsibleCard label="NYT — More Headlines" accent="hsl(220 90% 52%)" href="/news"
        count={nytMore.length}>
        <div>
          {nytMore.map((article) => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer"
              className="tap-row flex items-center min-h-[30px] gap-1.5 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              {article.section && <HubCap label={article.section} />}
              <span className="min-w-0 text-[10px] font-semibold leading-tight line-clamp-2 group-hover:underline">
                {article.title}
              </span>
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
    // Server Component: renders once per request and must read the wall clock.
    // The purity rule targets client components the compiler may memoise;
    // there is no pure way to ask "what time is it now" on the server.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const inSeason = [...snap.recentGames, ...snap.upcomingGames].some((g) => {
      const t = g.game_date ? new Date(g.game_date).getTime() : NaN;
      return Number.isFinite(t) && Math.abs(nowMs - t) <= IN_SEASON_WINDOW_MS;
    });
    if (!inSeason) continue;

    // One day's full slate per side rather than a fixed 4 + 2. Day is the
    // primary sort; favorites only break ties within that day, so a followed
    // team leads its own date without displacing a more recent one. A
    // favorite's game outside the leading day (e.g. a Friday game when
    // Saturday had the bigger CFB slate) still has to survive
    // `leadingDaySlate`'s day filter to reach that sort at all — bounded to
    // the single nearest outside day so it can't surface a team's whole
    // remaining schedule or (on the results side) a weeks-stale leftover.
    //
    // `CollapsibleCard` doesn't scroll internally, so a full college slate
    // (an 80-game NCAAF Saturday) needs a hard display cap per side too —
    // `capKeepingFavorites` keeps that cap from cutting a favorite that
    // landed past it.
    const MAX_GAMES_PER_SIDE = 20;
    const isFav = (g: ScoreRowType) => gameIsFavorite(favorites, snap.league!.league, g);
    const games = [
      ...capKeepingFavorites(
        byDayThenFavorites(
          leadingDaySlate(snap.recentGames, (g) => g.game_date, "desc", isFav),
          (g) => g.game_date,
          isFav,
          "desc",
        ),
        MAX_GAMES_PER_SIDE,
        isFav,
      ),
      ...capKeepingFavorites(
        byDayThenFavorites(
          leadingDaySlate(snap.upcomingGames, (g) => g.game_date, "asc", isFav),
          (g) => g.game_date,
          isFav,
          "asc",
        ),
        MAX_GAMES_PER_SIDE,
        isFav,
      ),
    ];
    const news = snap.news.slice(0, 3);
    const sportsSummary = [
      games.length > 0 && `${games.length} games`,
      news.length > 0 && `${news.length} news`,
    ].filter(Boolean).join(" · ");

    cards.push({ section: "sports", node: (
      <CollapsibleCard key={key}
        label={SPORTS_LABEL[key] ?? snap.league.display_name}
        accent="hsl(25 95% 50%)" href={`/${snap.league.league}`}
        count={games.length || undefined} summary={sportsSummary}
      >
        <div>
          {games.length > 0 && (
            <div className="score-grid border-b border-border">
              {games.map((g, i) => (
                <ScoreCell key={i} game={g} leagueSlug={snap.league!.league} favorite={isFav(g)} />
              ))}
            </div>
          )}
          <StandingsExpander
            groups={topNPerGroupWithFavorites(
              snap.standings,
              5,
              (t) => teamIsFavorite(favorites, snap.league!.league, t.team_name),
            )}
            leagueSlug={snap.league.league}
            favoriteTeamNames={favoriteTeamNamesForLeague(favorites, snap.league.league)}
          />
          {news.length > 0 && (
            /* Divider only when standings actually rendered above — the games
               grid already carries its own `border-b`, so an unconditional one
               would double up on leagues with no standings. */
            <div className={snap.standings.length > 0 ? "border-t border-border" : undefined}>
              {news.map((n) => (
                <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
                  className="tap-row flex items-center gap-1.5 min-h-[30px] px-2 py-0.5 border-b border-border last:border-0 text-[10px] leading-tight hover:bg-secondary/50 transition-colors group">
                  <HubCap label={n.source ?? "ESPN"} />
                  <span className="line-clamp-2 group-hover:underline">{n.title}</span>
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
              className="tap-row flex items-center min-h-[30px] gap-1.5 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
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
    const etfGroupNames = [
      ...ETF_GROUP_ORDER.filter((g) => etfsByGroup[g]),
      ...Object.keys(etfsByGroup).filter((g) => !ETF_GROUP_ORDER.includes(g)),
    ];
    cards.push({ section: "etfs", node: (
      <CollapsibleCard label="ETFs" accent="hsl(142 65% 42%)" href="/markets"
        count={assets.etfs.length} summary={`${assets.etfs.length} ETFs`}>
        <div>
          {etfGroupNames.map((group) => {
            const showAvg = group === "Macro/Market" || group === "Sectors";
            const avgPct = showAvg ? weightedAvgPercent(etfsByGroup[group]) : null;
            return (
              <div key={group}>
                <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border">
                  {group}
                </p>
                <TickerGrid
                  rows={etfsByGroup[group]}
                  href="/markets"
                  favoriteTickers={favorites.tickers}
                  leadCell={avgPct != null ? <WeightedAvgCell label={group} pct={avgPct} /> : undefined}
                />
              </div>
            );
          })}
        </div>
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
          {/* Remaining treasury maturities use the same column treatment as the
              yield curve: maturity label above the rate, one column each. */}
          {otherRows.map(([group, rows]) => (
            <div key={group}>
              <p className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground bg-secondary/40 border-b border-border">
                {group}
              </p>
              <div className="flex divide-x divide-border border-b border-border">
                {rows.map((row) => (
                  <div key={row.indicator_name} className="flex-1 px-1 py-1 text-center min-w-0">
                    <p className="text-[8px] font-mono text-muted-foreground leading-none truncate">
                      {ECON_CONFIG[row.indicator_name]?.label ?? row.indicator_name}
                    </p>
                    <p className="text-[10px] font-mono font-bold tabular-nums leading-tight mt-0.5">
                      {row.value.toFixed(2)}
                    </p>
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
              className="tap-row flex items-center min-h-[30px] gap-1.5 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              {item.source && <HubCap label={item.source} />}
              <div className="min-w-0">
                <p className="text-[10px] font-medium leading-tight line-clamp-2 group-hover:underline">
                  {item.headline}
                </p>
                {(item.related_tickers ?? []).length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                    {(item.related_tickers ?? []).slice(0, 3).map((t) => (
                      <TickerHoverChart key={t} ticker={t} href={`/markets/${t}`}
                        className="text-[8px] font-mono px-0.5 bg-secondary leading-none hover:bg-border">
                        {t}
                      </TickerHoverChart>
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
              <TickerGrid rows={assets.crypto} href="/markets" favoriteTickers={favorites.tickers} />
            </div>
          )}
          {hasCryptoHeadlines && (
            <div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {cryptoHeadlines.map((item: any) => (
                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                  className="tap-row flex items-center min-h-[30px] gap-1.5 px-2 py-0.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
                  {item.source && <HubCap label={item.source} />}
                  <p className="text-[10px] font-medium leading-tight line-clamp-2 group-hover:underline">
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
      <CollapsibleCard label="ForEx" accent="hsl(142 65% 42%)" href="/markets"
        count={Math.min(assets.forex.length, 9)} summary={`${assets.forex.length} pairs`}>
        {/* Nine fills the 3-wide grid exactly; the tenth is on /markets. */}
        <TickerGrid rows={assets.forex.slice(0, 9)} href="/markets" favoriteTickers={favorites.tickers} />
      </CollapsibleCard>
    )});
  }

  if (assets.commodities.length > 0) {
    cards.push({ section: "commodities", node: (
      <CollapsibleCard label="Commodities" accent="hsl(45 93% 47%)" href="/markets"
        count={assets.commodities.length} summary={`${assets.commodities.length} commodities`}>
        <TickerGrid rows={assets.commodities} href="/markets" favoriteTickers={favorites.tickers} />
      </CollapsibleCard>
    )});
  }

  if (youtubeVideos.length > 0) {
    cards.push({ section: "youtube", node: (
      <CollapsibleCard label="YouTube" accent="hsl(0 72% 50%)" href="/media"
        count={youtubeVideos.length}>
        <div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {youtubeVideos.slice(0, 8).map((v: any) => (
            <a key={v.id} href={`https://www.youtube.com/watch?v=${v.video_id}`}
              target="_blank" rel="noopener noreferrer"
              className="tap-row flex items-center gap-2 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group">
              {/* Video thumbnails are 16:9, so this is wider than the square
                  podcast art rather than cropped to match it. */}
              <ThumbImage
                src={v.thumbnail_url}
                detectYouTubePlaceholder
                className="w-8 h-[18px] shrink-0 object-cover border border-border"
                fallback={
                  <span className="w-8 h-[18px] shrink-0 flex items-center justify-center text-[10px]" style={{ color: "hsl(0 72% 50%)" }}>▶</span>
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold line-clamp-1 group-hover:underline">{v.title}</p>
                <p className="text-[8px] text-muted-foreground line-clamp-1">{v.channel_title}</p>
              </div>
              {v.view_count != null && (
                <span className="text-[8px] font-mono text-muted-foreground shrink-0 tabular-nums">
                  {v.view_count >= 1_000_000
                    ? `${(v.view_count / 1_000_000).toFixed(1)}M`
                    : `${Math.round(v.view_count / 1000)}K`}
                </span>
              )}
            </a>
          ))}
        </div>
      </CollapsibleCard>
    )});
  }

  // Standalone embeds — no CollapsibleCard chrome, just the players.
  for (const p of SPOTIFY_HOME_PLAYLISTS) {
    cards.push({ section: "spotify", node: (
      <iframe
        key={p.playlistId}
        src={spotifyPlaylistEmbedUrl(p.playlistId)}
        width="100%"
        height="152"
        allow={SPOTIFY_EMBED_ALLOW}
        loading="lazy"
        className={SPOTIFY_EMBED_CLASS}
        title={`Spotify playlist: ${p.name}`}
      />
    )});
  }

  const homePodcasts = buildPodcastList(favoritePodcastRows).slice(0, 10);
  const podcastImages = await getPodcastImages(homePodcasts.map((p) => p.showId));

  cards.push({ section: "podcasts", node: (
    <CollapsibleCard label="Spotify — Top Podcasts" accent="hsl(340 78% 50%)" href="/media"
      count={homePodcasts.length}>
      <div>
        {homePodcasts.map((p) => (
          <a
            key={p.showId}
            href={`https://open.spotify.com/show/${p.showId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
          >
            {(p.imageUrl ?? podcastImages[p.showId]) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.imageUrl ?? podcastImages[p.showId]}
                alt=""
                loading="lazy"
                className="w-5 h-5 shrink-0 object-cover border border-border"
              />
            ) : (
              <span className="w-5 h-5 shrink-0 flex items-center justify-center text-[10px]" style={{ color: "hsl(340 78% 50%)" }}>🎙</span>
            )}
            <span className="text-[10px] font-bold line-clamp-1 group-hover:underline flex-1 min-w-0">{p.name}</span>
            <FavoritePodcastButton
              showId={p.showId}
              name={p.name}
              imageUrl={p.imageUrl}
              initialFavorited={p.favorited}
              signedIn={signedIn}
              className="shrink-0"
            />
          </a>
        ))}
      </div>
    </CollapsibleCard>
  )});

  // Apply user prefs: hide, then stable-sort by section position.
  //
  // Sections added after a user saved their layout are spliced in at their
  // DEFAULT_HOME_ORDER neighbourhood, not appended. Appending meant every new
  // card landed at the bottom of the page for anyone with saved prefs, and no
  // amount of reordering DEFAULT_HOME_ORDER could move it — the saved list won
  // for every key it knew about, and the rest were dumped at the end.
  const orderList = (() => {
    const saved = (userOrder ?? []).filter((k) =>
      (DEFAULT_HOME_ORDER as string[]).includes(k)
    );
    if (saved.length === 0) return DEFAULT_HOME_ORDER as string[];

    const savedSet = new Set(saved);
    const result = [...saved];
    for (const key of DEFAULT_HOME_ORDER as string[]) {
      if (savedSet.has(key)) continue;
      // Anchor on the closest earlier default-order key the user already has,
      // so a new card appears where it was designed to sit rather than last.
      const defaults = DEFAULT_HOME_ORDER as string[];
      let anchor = -1;
      for (let i = defaults.indexOf(key) - 1; i >= 0; i--) {
        const at = result.indexOf(defaults[i]);
        if (at !== -1) {
          anchor = at;
          break;
        }
      }
      result.splice(anchor + 1, 0, key);
      savedSet.add(key);
    }
    return result;
  })();
  const sectionPos = new Map(orderList.map((k, i) => [k, i]));
  const visibleCards = cards
    .map((c, i) => ({ ...c, i }))
    .filter((c) => !hiddenSections.includes(c.section))
    .sort(
      (a, b) =>
        (sectionPos.get(a.section) ?? 99) - (sectionPos.get(b.section) ?? 99) || a.i - b.i
    );

  // Card elements carry their own row count, so the height model can read it
  // straight off the props instead of every push site passing a weight.
  // Card elements carry their own label, href, accent and row count, so both
  // the height model and the mobile focus toolbar read straight off the props
  // instead of every one of ~19 push sites passing them again.
  type CardProps = { count?: number; label?: string; href?: string; accent?: string };
  // Placement rules the height-balancer cannot infer, because they are
  // editorial rather than geometric:
  //
  //   top     — the AI briefings always lead the board.
  //   bottom  — the five misc cards never sit at the top of a column. This used
  //             to be implied by their position at the end of DEFAULT_HOME_ORDER
  //             plus a packer that filled in order; now that packing is
  //             largest-first, the rule has to be stated outright.
  //   column  — the briefings own the first column, exclusively.
  //   follow  — a card that reads as the previous one's companion and should sit
  //             directly beneath it: On This Day under Country of the Day, and
  //             Summary of the Week under Summary of the Day.
  const CARD_PLACEMENT: Partial<Record<HomeSectionKey, PackHint>> = {
    // The briefings summarise everything below them, so they lead the board:
    // pinned to the first column AND to the head of it, which together survive
    // both height-balancing and a reordered user layout. `exclusive` keeps the
    // rest of that column empty — together the two run ~840px, so any card
    // stacked underneath would start below the fold of every other column.
    ai_day: { column: 0, top: true, exclusive: true },
    ai_week: { follow: true },
    weather: { bottom: true },
    country: { bottom: true },
    onthisday: { follow: true, bottom: true },
    calendar: { bottom: true },
    // (Misc no longer pins to column 0 — that column is the briefings'.)
    almanac: { bottom: true },
  };

  const cardWeights: number[] = [];
  const cardHints: PackHint[] = [];
  const cardMeta: CardMeta[] = [];
  for (const c of visibleCards) {
    const el = c.node as React.ReactElement<CardProps>;
    const count = typeof el?.props?.count === "number" ? el.props.count : 6;
    cardWeights.push(estimateCardHeight(c.section, count));
    cardHints.push(CARD_PLACEMENT[c.section] ?? {});
    cardMeta.push({
      section: c.section,
      domain: SECTION_DOMAIN[c.section] ?? "misc",
      label: el?.props?.label ?? c.section,
      href: el?.props?.href ?? "/",
      accent: el?.props?.accent ?? "hsl(220 6% 50%)",
    });
  }

  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      <CommandCenterCards meta={cardMeta} weights={cardWeights} hints={cardHints}>
        {visibleCards.map((c, i) => (
          <Fragment key={`${c.section}-${i}`}>{c.node}</Fragment>
        ))}
      </CommandCenterCards>
    </div>
  );
}
