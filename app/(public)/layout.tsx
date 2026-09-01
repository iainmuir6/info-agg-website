import Link from "next/link";
import { unstable_cache } from "next/cache";
import { CategoryNav } from "@/components/category-nav";
import { SectionFilterProvider } from "@/components/section-filter";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient, createStaticClient } from "@/lib/supabase/server";
import { FooterTickers } from "@/components/footer-tickers";
import { FooterGate } from "@/components/footer-gate";
import { HeaderDate } from "@/components/header-date";
import {
  normalizeSportsRows,
  type SportsTickerItem,
} from "@/components/sports-ticker-client";
import {
  normalizeTickerRows,
  TICKER_MAG7,
  TICKER_ETFS,
  type TickerItem,
} from "@/components/news-ticker-client";
import { APP_TIME_ZONE } from "@/lib/format-date";

// Initial ticker snapshot — cached and revalidated by the ETL webhook
// (POST /api/revalidate); the client component then polls on its own.
const getTickerItems = unstable_cache(
  async (): Promise<TickerItem[]> => {
    const supabase = createStaticClient();
    try {
      const [equitiesRes, etfsRes] = await Promise.all([
        supabase
          .from("stocks")
          .select(`ticker, stock_quotes(current_price, percent_change, quote_timestamp)`)
          .in("ticker", TICKER_MAG7)
          .eq("is_active", true),
        supabase
          .from("stocks")
          .select(`ticker, stock_quotes(current_price, percent_change, quote_timestamp)`)
          .in("ticker", TICKER_ETFS)
          .eq("is_active", true),
      ]);
      return [
        ...normalizeTickerRows(equitiesRes.data ?? [], TICKER_MAG7),
        ...normalizeTickerRows(etfsRes.data ?? [], TICKER_ETFS),
      ];
    } catch {
      return [];
    }
  },
  ["ticker-items"],
  { tags: ["etl-data"], revalidate: 300 },
);

// Sports ticker snapshot — games from the last 36h / next 24h
const getSportsTickerItems = unstable_cache(
  async (): Promise<SportsTickerItem[]> => {
    try {
      const supabase = createStaticClient();
      const { data } = await supabase
        .from("sports_scores")
        .select("id, home_team, away_team, home_abbrev, away_abbrev, home_score, away_score, status, status_detail, game_date, leagues(league)")
        .gte("game_date", new Date(Date.now() - 36 * 3600 * 1000).toISOString())
        .lte("game_date", new Date(Date.now() + 24 * 3600 * 1000).toISOString())
        .order("game_date", { ascending: false })
        .limit(30);
      return normalizeSportsRows(data ?? []);
    } catch {
      return [];
    }
  },
  ["sports-ticker-items"],
  { tags: ["etl-data"], revalidate: 120 },
);

type EtlHealth = {
  color: string;
  label: string;
  /** Just the relative-age part ("34m ago") — the mobile header shows this
   *  alone next to the dot, with no "Updated" prefix. Null when no run yet. */
  age: string | null;
};

// Header health dot, driven by the latest etl_runs row instead of being
// hardcoded green: fresh (<2h) → green, stale (<26h) → amber, else red.
const getEtlHealth = unstable_cache(
  async (): Promise<EtlHealth> => {
    const fallback: EtlHealth = { color: "hsl(45 90% 45%)", label: "No sync data", age: null };
    try {
      const supabase = createStaticClient();
      const { data } = await supabase
        .from("etl_runs")
        .select("status, finished_at, started_at")
        .order("started_at", { ascending: false })
        .limit(5);
      const lastFinished = (data ?? []).find(
        (r) => r.finished_at && (r.status === "success" || r.status === "partial"),
      );
      if (!lastFinished) return fallback;
      const ageMs = Date.now() - new Date(lastFinished.finished_at as string).getTime();
      const ageMin = Math.round(ageMs / 60_000);
      const ageLabel =
        ageMin < 60 ? `${ageMin}m ago` : ageMin < 60 * 26 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;
      if (ageMs < 2 * 3600_000) return { color: "hsl(142 65% 42%)", label: `Updated ${ageLabel}`, age: ageLabel };
      if (ageMs < 26 * 3600_000) return { color: "hsl(45 90% 45%)", label: `Updated ${ageLabel}`, age: ageLabel };
      return { color: "hsl(0 72% 50%)", label: `Stale — ${ageLabel}`, age: ageLabel };
    } catch {
      return fallback;
    }
  },
  ["etl-health"],
  { tags: ["etl-data"], revalidate: 60 },
);

// `domain` ties each link to the Command Center sections it covers, so a tap
// on a phone can filter the dashboard instead of navigating (see CategoryNav
// and SECTION_DOMAIN in lib/home-sections.ts).
const NAV_LINKS = [
  { href: "/news", label: "NEWS", accent: "hsl(220 90% 52%)", domain: "news" },
  { href: "/sports", label: "SPORTS", accent: "hsl(25 95% 50%)", domain: "sports" },
  { href: "/markets", label: "MARKETS", accent: "hsl(142 65% 42%)", domain: "markets" },
  { href: "/media", label: "MEDIA", accent: "hsl(340 78% 50%)", domain: "media" },
  { href: "/misc", label: "MISC", accent: "hsl(265 70% 55%)", domain: "misc" },
];

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Server renders Eastern time (it has no visitor timezone); HeaderDate
  // swaps in the reader's own timezone on the client.
  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: APP_TIME_ZONE,
    })
    .toUpperCase();
  const dateStrShort = now
    .toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: APP_TIME_ZONE,
    })
    .toUpperCase();

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = !!claimsData?.claims;
  const etlHealth = await getEtlHealth();

  // Profile bubble: FL initials when a display name is set, first two email
  // characters otherwise.
  const displayName = (
    claimsData?.claims?.user_metadata as { display_name?: string } | undefined
  )?.display_name?.trim();
  let bubbleInitials: string | undefined;
  if (displayName) {
    const parts = displayName.split(/\s+/);
    bubbleInitials = (
      parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")
    ).toUpperCase();
  }
  bubbleInitials ??=
    (claimsData?.claims?.email as string | undefined)?.slice(0, 2).toUpperCase() ?? "??";

  return (
    // The nav sets the mobile dashboard filter and the card list inside
    // `children` reads it, so the provider has to sit above both.
    <SectionFilterProvider>
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        {/* Masthead */}
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3 border-b border-border">
          <Link href="/" className="flex flex-col group min-w-0">
            <span
              className="text-lg sm:text-xl font-black tracking-tighter leading-none group-hover:opacity-80 transition-opacity"
              style={{ fontFamily: "Georgia, serif" }}
            >
              INFO HUB
            </span>
            <HeaderDate initialLong={dateStr} initialShort={dateStrShort} />
          </Link>

          <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
            <div className="flex items-center gap-1.5" title={etlHealth.label}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: etlHealth.color }} />
              <span className="hidden sm:inline text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                {etlHealth.label}
              </span>
              {etlHealth.age && (
                <span className="sm:hidden text-[9px] font-mono tracking-wider text-muted-foreground uppercase tabular-nums">
                  {etlHealth.age}
                </span>
              )}
            </div>
            {!isAuthenticated ? (
              <Link
                href="/auth/login"
                className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 hover:border-foreground transition-colors"
              >
                Sign In
              </Link>
            ) : (
              <>
                <Link
                  href="/profile"
                  className="flex items-center justify-center w-7 h-7 rounded-full border border-border text-[10px] font-mono font-bold tracking-wider text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                  title="Profile"
                >
                  {bubbleInitials}
                </Link>
              </>
            )}
            <ThemeSwitcher />
          </div>
        </div>

        {/* Category nav — evenly spaced on mobile, left-aligned from sm up */}
        <CategoryNav links={NAV_LINKS} />
      </header>

      <main className="flex-1">{children}</main>

      <FooterGate>
        <FooterTickers quotes={await getTickerItems()} games={await getSportsTickerItems()} />
      </FooterGate>
    </div>
    </SectionFilterProvider>
  );
}
