import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const SECTIONS = [
  {
    href: "/protected/news",
    label: "NEWS",
    accent: "news",
    accentColor: "hsl(220 90% 52%)",
    icon: "◈",
    description: "Top stories from NYT and NewsAPI across all categories.",
    table: "news_articles",
    countField: "id",
  },
  {
    href: "/protected/sports",
    label: "SPORTS",
    accent: "sports",
    accentColor: "hsl(25 95% 50%)",
    icon: "◉",
    description: "Live scores and news from ESPN — NFL, NBA, MLB, NHL, EPL.",
    table: "sports_news",
    countField: "id",
  },
  {
    href: "/protected/markets",
    label: "MARKETS",
    accent: "markets",
    accentColor: "hsl(142 65% 42%)",
    icon: "◆",
    description: "Real-time stock quotes and market news. Powered by Finnhub.",
    table: "stock_quotes",
    countField: "id",
  },
  {
    href: "/protected/media",
    label: "MEDIA",
    accent: "media",
    accentColor: "hsl(340 78% 50%)",
    icon: "◎",
    description: "Spotify new releases and trending Reddit posts.",
    table: "spotify_releases",
    countField: "id",
  },
];

async function getDataCounts(supabase: Awaited<ReturnType<typeof createClient>>) {
  const counts: Record<string, number> = {};

  await Promise.all(
    SECTIONS.map(async (s) => {
      try {
        const { count } = await supabase
          .from(s.table)
          .select("*", { count: "exact", head: true });
        counts[s.label] = count ?? 0;
      } catch {
        counts[s.label] = 0;
      }
    })
  );

  return counts;
}

async function getLatestNews(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("news_articles")
      .select("title, source, section, published_at")
      .order("published_at", { ascending: false })
      .limit(5);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getLatestStocks(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("stock_quotes")
      .select("current_price, percent_change, stocks(ticker)")
      .order("fetched_at", { ascending: false })
      .limit(7);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getLatestScores(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("sports_scores")
      .select("home_team, away_team, home_score, away_score, status, leagues(sport)")
      .order("game_date", { ascending: false })
      .limit(4);
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const [counts, latestNews, latestStocks, latestScores] = await Promise.all([
    getDataCounts(supabase),
    getLatestNews(supabase),
    getLatestStocks(supabase),
    getLatestScores(supabase),
  ]);

  const now = new Date();

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-black tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
            COMMAND OVERVIEW
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          ALL SYSTEMS · {Object.values(counts).some((v) => v > 0) ? "DATA LOADED" : "AWAITING SYNC"}
        </p>
      </div>

      {/* Category cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        {SECTIONS.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="bg-background p-5 group hover:bg-secondary transition-colors block"
          >
            <div
              className="w-6 h-0.5 mb-4"
              style={{ backgroundColor: s.accentColor }}
            />
            <div className="flex items-start justify-between mb-3">
              <span
                className="text-sm font-mono tracking-widest uppercase"
                style={{ color: s.accentColor }}
              >
                {s.icon} {s.label}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {(counts[s.label] ?? 0).toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              {s.description}
            </p>
            <span className="text-xs font-mono tracking-wider text-foreground group-hover:underline">
              OPEN →
            </span>
          </Link>
        ))}
      </div>

      {/* Data panes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
        {/* Latest headlines */}
        <div className="bg-background p-5 md:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono tracking-widest uppercase text-news">
              ◈ Latest Headlines
            </span>
            <Link href="/protected/news" className="text-[10px] font-mono text-muted-foreground hover:text-foreground uppercase tracking-wider">
              View All →
            </Link>
          </div>
          <div className="space-y-3">
            {latestNews.length > 0 ? (
              latestNews.map((a: any, i: number) => (
                <div key={i} className="border-b border-border pb-3 last:border-0">
                  <p className="text-xs leading-snug font-medium line-clamp-2">{a.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">
                      {a.source}
                    </span>
                    {a.section && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        · {a.section}
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground font-mono">No data — run ETL to sync</p>
            )}
          </div>
        </div>

        {/* Stock quotes */}
        <div className="bg-background p-5 md:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono tracking-widest uppercase text-markets">
              ◆ Markets
            </span>
            <Link href="/protected/markets" className="text-[10px] font-mono text-muted-foreground hover:text-foreground uppercase tracking-wider">
              View All →
            </Link>
          </div>
          <div className="space-y-2">
            {latestStocks.length > 0 ? (
              latestStocks.map((q: any, i: number) => {
                const change = parseFloat(q.percent_change ?? 0);
                const isPos = change >= 0;
                return (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-xs font-mono font-bold">
                      {(q.stocks as any)?.ticker ?? "—"}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      ${parseFloat(q.current_price ?? 0).toFixed(2)}
                    </span>
                    <span
                      className="text-xs font-mono"
                      style={{ color: isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                    >
                      {isPos ? "+" : ""}{change.toFixed(2)}%
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground font-mono">No data — run ETL to sync</p>
            )}
          </div>
        </div>

        {/* Live scores */}
        <div className="bg-background p-5 md:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono tracking-widest uppercase text-sports">
              ◉ Live Scores
            </span>
            <Link href="/protected/sports" className="text-[10px] font-mono text-muted-foreground hover:text-foreground uppercase tracking-wider">
              View All →
            </Link>
          </div>
          <div className="space-y-2">
            {latestScores.length > 0 ? (
              latestScores.map((g: any, i: number) => (
                <div key={i} className="py-2 border-b border-border last:border-0">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-muted-foreground w-16 truncate">{g.away_team}</span>
                    <span className="text-foreground font-bold">{g.away_score ?? "—"}</span>
                    <span className="text-[10px] text-muted-foreground px-2">vs</span>
                    <span className="text-foreground font-bold">{g.home_score ?? "—"}</span>
                    <span className="text-muted-foreground w-16 truncate text-right">{g.home_team}</span>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{g.status}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground font-mono">No data — run ETL to sync</p>
            )}
          </div>
        </div>
      </div>

      {/* ETL status / trigger */}
      <div className="border border-border p-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-mono tracking-widest uppercase text-muted-foreground">
            Data Sync
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Run the Python ETL to populate all data sources.
          </p>
        </div>
        <code className="text-xs font-mono bg-secondary px-3 py-1.5 text-muted-foreground">
          python src/api/run_etl.py
        </code>
      </div>
    </div>
  );
}
