import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { EtlTriggerButton } from "@/components/etl-trigger";

type TableRow = { label: string; count: number | null };

type DomainStat = {
  domain: string;
  accent: string;
  rows: TableRow[];
  lastFetch: string | null;
};

async function getDomainStats(): Promise<DomainStat[]> {
  const supabase = await createClient();

  const [
    sportsNewsCount,
    sportsScoresCount,
    sportsLastFetch,
    stocksCount,
    quotesCount,
    companyNewsCount,
    marketsLastFetch,
    newsCount,
    newsLastFetch,
    spotifyCount,
    redditCount,
    mediaLastFetch,
  ] = await Promise.all([
    supabase.from("sports_news").select("*",      { count: "exact", head: true }),
    supabase.from("sports_scores").select("*",    { count: "exact", head: true }),
    supabase.from("sports_news").select("created_at").order("created_at", { ascending: false }).limit(1),

    supabase.from("stocks").select("*",           { count: "exact", head: true }).eq("is_active", true),
    supabase.from("stock_quotes").select("*",     { count: "exact", head: true }),
    supabase.from("company_news").select("*",     { count: "exact", head: true }),
    supabase.from("stock_quotes").select("fetched_at").order("fetched_at", { ascending: false }).limit(1),

    supabase.from("news_articles").select("*",    { count: "exact", head: true }),
    supabase.from("news_articles").select("created_at").order("created_at", { ascending: false }).limit(1),

    supabase.from("spotify_releases").select("*", { count: "exact", head: true }),
    supabase.from("reddit_posts").select("*",     { count: "exact", head: true }),
    supabase.from("spotify_releases").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);

  return [
    {
      domain: "Sports",
      accent: "hsl(25 95% 50%)",
      rows: [
        { label: "News articles", count: sportsNewsCount.count },
        { label: "Score records", count: sportsScoresCount.count },
      ],
      lastFetch: sportsLastFetch.data?.[0]?.created_at ?? null,
    },
    {
      domain: "Markets",
      accent: "hsl(142 65% 42%)",
      rows: [
        { label: "Tracked stocks", count: stocksCount.count },
        { label: "Quote snapshots", count: quotesCount.count },
        { label: "Company news",   count: companyNewsCount.count },
      ],
      lastFetch: marketsLastFetch.data?.[0]?.fetched_at ?? null,
    },
    {
      domain: "News",
      accent: "hsl(220 90% 52%)",
      rows: [
        { label: "Articles", count: newsCount.count },
      ],
      lastFetch: newsLastFetch.data?.[0]?.created_at ?? null,
    },
    {
      domain: "Media",
      accent: "hsl(340 78% 50%)",
      rows: [
        { label: "Spotify releases", count: spotifyCount.count },
        { label: "Reddit posts",     count: redditCount.count },
      ],
      lastFetch: mediaLastFetch.data?.[0]?.created_at ?? null,
    },
  ];
}

function syncAge(isoDate: string | null): string {
  if (!isoDate) return "never";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export default async function DashboardPage() {
  const admin = await isSuperAdmin();
  if (!admin) redirect("/");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const email = (claimsData?.claims?.email as string | undefined) ?? "";

  const stats = await getDomainStats();

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tighter" style={{ fontFamily: "Georgia, serif" }}>
          ADMIN DASHBOARD
        </h1>
        <div className="mt-1 border-t-4 border-double border-border" />
        <p className="mt-2 text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
          {email}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.domain} className="border border-border">
            {/* Domain header */}
            <div
              className="px-3 py-2 border-b border-border flex items-center justify-between"
              style={{ borderLeftColor: s.accent, borderLeftWidth: 3 }}
            >
              <span className="text-[10px] font-mono tracking-widest uppercase font-bold">
                {s.domain}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
                {syncAge(s.lastFetch)}
              </span>
            </div>

            {/* Table rows */}
            <div className="px-3 py-3 flex flex-col gap-2">
              {s.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4">
                  <span className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase truncate">
                    {r.label}
                  </span>
                  <span className="text-sm font-black tabular-nums shrink-0">
                    {r.count?.toLocaleString() ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <EtlTriggerButton />
        <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
          Sports · News · Market quotes — skips sentiment, media, and economic indicators
        </span>
      </div>
    </div>
  );
}
