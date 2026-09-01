// Command Center section registry — shared by the homepage (server) and the
// profile-page layout editor (client). Keys are persisted in
// info_agg.user_home_prefs, so renaming a key orphans saved prefs.

export type HomeSectionKey =
  | "stocks"
  | "etfs"
  | "forex"
  | "commodities"
  | "econ"
  | "crypto"
  | "stock_news"
  | "market_news"
  | "nyt"
  | "nyt_more"
  | "sports"
  | "spotify"
  | "podcasts"
  | "youtube"
  | "weather"
  | "calendar"
  | "country"
  | "onthisday"
  | "almanac";

export const HOME_SECTIONS: { key: HomeSectionKey; label: string }[] = [
  { key: "stocks", label: "Stocks" },
  { key: "nyt", label: "NYT Top Stories" },
  { key: "sports", label: "Sports" },
  { key: "nyt_more", label: "NYT More Headlines" },
  { key: "market_news", label: "Market News" },
  { key: "etfs", label: "ETFs" },
  { key: "econ", label: "Economic Indicators" },
  { key: "stock_news", label: "Stock News" },
  { key: "crypto", label: "Crypto" },
  { key: "forex", label: "Forex" },
  { key: "commodities", label: "Commodities" },
  { key: "spotify", label: "Spotify" },
  { key: "podcasts", label: "Top Podcasts" },
  { key: "youtube", label: "YouTube" },
  // Misc sections are pinned to the END of the order on purpose. The masonry
  // assigns cards round-robin (item i -> column i % cols), so an item's row
  // within its column is floor(i / cols) — the only way to guarantee a card
  // sits at the BOTTOM of whatever column it lands in is for it to be among
  // the last `cols` items. Keeping all five here does that at any column count.
  { key: "weather", label: "Weather" },
  { key: "country", label: "Country of the Day" },
  { key: "onthisday", label: "On This Day" },
  { key: "calendar", label: "Calendar" },
  { key: "almanac", label: "Misc" },
];

// Deliberately interleaved: markets / news / sports alternate instead of
// all-markets-first, all-sports-last.
export const DEFAULT_HOME_ORDER: HomeSectionKey[] = HOME_SECTIONS.map((s) => s.key);

export function sectionLabel(key: string): string {
  return HOME_SECTIONS.find((s) => s.key === key)?.label ?? key;
}
