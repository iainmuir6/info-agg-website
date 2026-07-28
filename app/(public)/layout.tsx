import Link from "next/link";
import { unstable_cache } from "next/cache";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient, createStaticClient } from "@/lib/supabase/server";
import { FooterTickers } from "@/components/footer-tickers";
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

// Initial ticker snapshot — cached and revalidated by the ETL webhook
// (POST /api/revalidate); the client component then polls on its own.
const getTickerItems = unstable_cache(
  async (): Promise<TickerItem[]> => {
    const supabase = createStaticClient();
    try {
      const [equitiesRes, etfsRes] = await Promise.all([
        supabase
          .from("stocks")
          .select(`ticker, stock_quotes(current_price, percent_change, fetched_at)`)
          .in("ticker", TICKER_MAG7)
          .eq("is_active", true),
        supabase
          .from("stocks")
          .select(`ticker, stock_quotes(current_price, percent_change, fetched_at)`)
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
};

// Header health dot, driven by the latest etl_runs row instead of being
// hardcoded green: fresh (<2h) → green, stale (<26h) → amber, else red.
const getEtlHealth = unstable_cache(
  async (): Promise<EtlHealth> => {
    const fallback: EtlHealth = { color: "hsl(45 90% 45%)", label: "No sync data" };
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
      if (ageMs < 2 * 3600_000) return { color: "hsl(142 65% 42%)", label: `Updated ${ageLabel}` };
      if (ageMs < 26 * 3600_000) return { color: "hsl(45 90% 45%)", label: `Updated ${ageLabel}` };
      return { color: "hsl(0 72% 50%)", label: `Stale — ${ageLabel}` };
    } catch {
      return fallback;
    }
  },
  ["etl-health"],
  { tags: ["etl-data"], revalidate: 60 },
);

const NAV_LINKS = [
  { href: "/news", label: "NEWS", accent: "hsl(220 90% 52%)" },
  { href: "/sports", label: "SPORTS", accent: "hsl(25 95% 50%)" },
  { href: "/markets", label: "MARKETS", accent: "hsl(142 65% 42%)" },
  { href: "/media", label: "MEDIA", accent: "hsl(340 78% 50%)" },
];

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = !!claimsData?.claims;
  const etlHealth = await getEtlHealth();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        {/* Masthead */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-border">
          <Link href="/" className="flex flex-col group">
            <span
              className="text-xl font-black tracking-tighter leading-none group-hover:opacity-80 transition-opacity"
              style={{ fontFamily: "Georgia, serif" }}
            >
              INFO HUB
            </span>
            <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
              {dateStr}
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5" title={etlHealth.label}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: etlHealth.color }} />
              <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                {etlHealth.label}
              </span>
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
                  {(claimsData?.claims?.email as string | undefined)?.slice(0, 2).toUpperCase() ?? "??"}
                </Link>
              </>
            )}
            <ThemeSwitcher />
          </div>
        </div>

        {/* Category nav — evenly spaced on mobile, left-aligned from sm up */}
        <nav className="px-2 sm:px-6 flex items-center">
          <div className="flex items-center w-full sm:w-auto sm:gap-1">
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex-1 sm:flex-none text-center px-2 sm:px-4 py-2.5 text-[11px] sm:text-xs font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors group"
              >
                {item.label}
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"
                  style={{ backgroundColor: item.accent }}
                />
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <FooterTickers quotes={await getTickerItems()} games={await getSportsTickerItems()} />
    </div>
  );
}
