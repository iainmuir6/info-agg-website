import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WatchlistStocks } from "@/components/watchlist-stocks";
import { WatchlistLeagues } from "@/components/watchlist-leagues";

export default async function WatchlistPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) redirect("/auth/login");

  const userId = claimsData.claims.sub as string;

  const [watchlistStocksRes, allLeaguesRes, watchlistLeaguesRes] = await Promise.all([
    supabase
      .from("watchlist_stocks")
      .select("id, stock_id, stocks(ticker, name, stock_quotes(current_price, percent_change, fetched_at))")
      .eq("user_id", userId),
    supabase.from("leagues").select("id, display_name, sport").eq("is_active", true),
    supabase.from("watchlist_leagues").select("league_id").eq("user_id", userId),
  ]);

  // Build stock list with latest quote
  const trackedLeagueIds = new Set((watchlistLeaguesRes.data ?? []).map((r: any) => r.league_id));

  const stocks = (watchlistStocksRes.data ?? []).map((row: any) => {
    const quotes = (row.stocks?.stock_quotes ?? []).sort(
      (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
    );
    const latest = quotes[0];
    return {
      id: row.id,
      stock_id: row.stock_id,
      ticker: row.stocks?.ticker ?? "",
      name: row.stocks?.name ?? "",
      current_price: latest ? parseFloat(latest.current_price) : null,
      percent_change: latest ? parseFloat(latest.percent_change) : null,
    };
  });

  const leagues = (allLeaguesRes.data ?? []).map((l: any) => ({
    id: l.id,
    display_name: l.display_name,
    sport: l.sport,
    tracked: trackedLeagueIds.has(l.id),
  }));

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tighter" style={{ fontFamily: "Georgia, serif" }}>
          WATCHLIST
        </h1>
        <div className="mt-1 border-t-4 border-double border-border" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <WatchlistStocks initialStocks={stocks} />
        <WatchlistLeagues initialLeagues={leagues} />
      </div>
    </div>
  );
}
