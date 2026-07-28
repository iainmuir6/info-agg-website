import Link from "next/link";
import { unstable_cache } from "next/cache";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient, createStaticClient } from "@/lib/supabase/server";
import {
  NewsTickerClient,
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

        {/* Category nav + centered title */}
        <nav className="px-6 flex items-center overflow-x-auto">
          <div className="flex items-center gap-1">
            <Link
              href="/"
              className="px-4 py-2.5 text-xs font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Overview
            </Link>
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="relative px-4 py-2.5 text-xs font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
              >
                {item.label}
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"
                  style={{ backgroundColor: item.accent }}
                />
              </Link>
            ))}
          </div>

          <div className="flex-1 flex justify-center">
            <span
              className="text-xs font-mono tracking-[0.2em] uppercase text-muted-foreground"
              style={{ fontFamily: "Georgia, serif" }}
            >
              COMMAND CENTER
            </span>
          </div>

          <div className="w-24 shrink-0" />
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        {/* Market ticker row */}
        <div className="border-b border-border">
          <NewsTickerClient items={await getTickerItems()} />
        </div>

        {/* Footer meta */}
        <div className="px-6 py-3 flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
            INFORMATION AGGREGATOR
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{now.getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
