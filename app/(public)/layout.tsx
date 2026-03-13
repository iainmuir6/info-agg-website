import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient } from "@/lib/supabase/server";
import { NewsTickerClient } from "@/components/news-ticker-client";

type TickerItem = {
  label: string;
  value: string;
  change: number;
};

async function getTickerItems(): Promise<TickerItem[]> {
  const supabase = await createClient();

  const MAG7 = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "META", "TSLA"];
  const ETFS = ["SPY", "QQQ", "DIA", "IWM", "VTI"];

  try {
    const [equitiesRes, etfsRes] = await Promise.all([
      supabase
        .from("stocks")
        .select(`ticker, stock_quotes(current_price, percent_change, fetched_at)`)
        .in("ticker", MAG7)
        .eq("is_active", true),
      supabase
        .from("stocks")
        .select(`ticker, stock_quotes(current_price, percent_change, fetched_at)`)
        .in("ticker", ETFS)
        .eq("is_active", true),
    ]);

    const normalize = (rows: any[], order: string[]): TickerItem[] => {
      return (rows ?? [])
        .map((s: any) => {
          const quotes = (s.stock_quotes ?? []).sort(
            (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
          );
          const latest = quotes[0];
          if (!latest) return null;
          return {
            label: s.ticker,
            value: `$${parseFloat(latest.current_price ?? 0).toFixed(2)}`,
            change: parseFloat(latest.percent_change ?? 0),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => order.indexOf(a.label) - order.indexOf(b.label));
    };

    const equities = normalize(equitiesRes.data ?? [], MAG7);
    const etfs = normalize(etfsRes.data ?? [], ETFS);

    return [...equities, ...etfs];
  } catch {
    return [];
  }
}

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
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: "hsl(142 65% 42%)" }} />
              <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                Live
              </span>
            </div>
            <Link
              href="/auth/login"
              className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 hover:border-foreground transition-colors"
            >
              Sign In
            </Link>
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
