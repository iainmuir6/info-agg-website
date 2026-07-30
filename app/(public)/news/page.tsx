import { createClient } from "@/lib/supabase/server";
import NewsInfiniteScroll from "./NewsInfiniteScroll";
import { formatDateTime } from "@/lib/format-date";

async function getNewsStats(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { count: totalCount } = await supabase
      .from("news_articles")
      .select("*", { count: "exact", head: true });

    const { count: nytCount } = await supabase
      .from("news_articles")
      .select("*", { count: "exact", head: true })
      .eq("source", "nyt");

    const { count: newsapiCount } = await supabase
      .from("news_articles")
      .select("*", { count: "exact", head: true })
      .eq("source", "newsapi");

    const { data: latestRow } = await supabase
      .from("news_articles")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();

    return {
      total: totalCount ?? 0,
      nyt: nytCount ?? 0,
      newsapi: newsapiCount ?? 0,
      lastSync: latestRow?.fetched_at ?? null,
    };
  } catch {
    return { total: 0, nyt: 0, newsapi: 0, lastSync: null };
  }
}

export default async function NewsPage() {
  const supabase = await createClient();
  const stats = await getNewsStats(supabase);

  const lastSyncStr = stats.lastSync ? formatDateTime(stats.lastSync, true) : "Never";

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Page header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            <span style={{ color: "hsl(220 90% 52%)" }}>◈</span> NEWS FEED
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            {stats.total.toLocaleString()} articles
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
              NYT
            </span>
            <span className="text-[10px] font-mono text-foreground font-bold">
              {stats.nyt.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
              NewsAPI
            </span>
            <span className="text-[10px] font-mono text-foreground font-bold">
              {stats.newsapi.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
              Last Sync
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{lastSyncStr}</span>
          </div>
        </div>
      </div>

      {/* Infinite scroll news list (client component) */}
      <NewsInfiniteScroll />
    </div>
  );
}
