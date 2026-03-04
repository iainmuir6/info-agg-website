import { createClient } from "@/lib/supabase/server";

type StockWithQuote = {
  id: number;
  ticker: string;
  name: string | null;
  exchange: string | null;
  industry: string | null;
  logo_url: string | null;
  stock_quotes: {
    current_price: number;
    change_amount: number;
    percent_change: number;
    high_price: number;
    low_price: number;
    open_price: number;
    previous_close: number;
    fetched_at: string;
  }[];
};

type MarketNews = {
  id: number;
  category: string;
  headline: string;
  summary: string | null;
  url: string;
  image_url: string | null;
  source: string | null;
  published_at: string | null;
  related_tickers: string[] | null;
};

async function getMarketsData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [stocksRes, newsRes] = await Promise.all([
    supabase
      .from("stocks")
      .select(`
        id, ticker, name, exchange, industry, logo_url,
        stock_quotes (
          current_price, change_amount, percent_change,
          high_price, low_price, open_price, previous_close, fetched_at
        )
      `)
      .eq("is_active", true)
      .order("ticker"),
    supabase
      .from("market_news")
      .select("id, category, headline, summary, url, image_url, source, published_at, related_tickers")
      .order("published_at", { ascending: false })
      .limit(30),
  ]);

  // For each stock, get the most recent quote
  const stocks = (stocksRes.data ?? []).map((s: any) => ({
    ...s,
    quote: s.stock_quotes?.sort(
      (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
    )[0] ?? null,
  }));

  return {
    stocks,
    news: (newsRes.data ?? []) as MarketNews[],
  };
}

function formatNum(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function formatMarketCap(n: number | null | undefined) {
  if (!n) return null;
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toString();
}

export default async function MarketsPage() {
  const supabase = await createClient();
  const { stocks, news } = await getMarketsData(supabase);

  const stocksWithQuotes = stocks.filter((s: any) => s.quote);
  const stocksNoQuote = stocks.filter((s: any) => !s.quote);
  const hasData = stocks.length > 0;

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            <span style={{ color: "hsl(142 65% 42%)" }}>◆</span> MARKETS
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            {stocks.length} stocks tracked
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          FINNHUB · ALPHA VANTAGE · REAL-TIME QUOTES
        </p>
      </div>

      {!hasData ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">
            NO DATA — Run the ETL to sync market data.
          </p>
          <code className="text-xs font-mono text-muted-foreground block mt-3">
            python src/api/run_etl.py --markets-only
          </code>
        </div>
      ) : (
        <>
          {/* Stock quotes table */}
          <div>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
              Watchlist — {stocksWithQuotes.length} with live quotes
            </p>

            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-[120px_1fr_100px_80px_80px_80px_80px_80px] gap-0 bg-border mb-px">
              <div className="bg-secondary px-4 py-2">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Ticker</span>
              </div>
              <div className="bg-secondary px-4 py-2">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Name</span>
              </div>
              <div className="bg-secondary px-4 py-2 text-right">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Price</span>
              </div>
              <div className="bg-secondary px-4 py-2 text-right">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Chg%</span>
              </div>
              <div className="bg-secondary px-4 py-2 text-right">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Open</span>
              </div>
              <div className="bg-secondary px-4 py-2 text-right">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">High</span>
              </div>
              <div className="bg-secondary px-4 py-2 text-right">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Low</span>
              </div>
              <div className="bg-secondary px-4 py-2 text-right">
                <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Prev</span>
              </div>
            </div>

            <div className="space-y-px bg-border">
              {stocksWithQuotes.map((stock: any, i: number) => {
                const q = stock.quote;
                const pct = parseFloat(q.percent_change ?? 0);
                const isPos = pct >= 0;
                const changeColor = isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)";

                return (
                  <div
                    key={stock.id}
                    className="bg-background hover:bg-secondary transition-colors animate-fade-in-up"
                    style={{ animationDelay: `${i * 0.03}s` }}
                  >
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-[120px_1fr_100px_80px_80px_80px_80px_80px] gap-0">
                      <div className="px-4 py-3 flex items-center">
                        <span className="text-sm font-mono font-black tracking-tight">
                          {stock.ticker}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-center min-w-0">
                        <span className="text-xs text-muted-foreground truncate">
                          {stock.name ?? "—"}
                        </span>
                      </div>
                      <div className="px-4 py-3 text-right flex items-center justify-end">
                        <span className="text-sm font-mono font-bold tabular-nums">
                          ${formatNum(q.current_price)}
                        </span>
                      </div>
                      <div className="px-4 py-3 text-right flex items-center justify-end">
                        <span
                          className="text-xs font-mono font-bold tabular-nums"
                          style={{ color: changeColor }}
                        >
                          {isPos ? "+" : ""}{formatNum(pct)}%
                        </span>
                      </div>
                      <div className="px-4 py-3 text-right flex items-center justify-end">
                        <span className="text-xs font-mono text-muted-foreground tabular-nums">
                          ${formatNum(q.open_price)}
                        </span>
                      </div>
                      <div className="px-4 py-3 text-right flex items-center justify-end">
                        <span className="text-xs font-mono text-muted-foreground tabular-nums">
                          ${formatNum(q.high_price)}
                        </span>
                      </div>
                      <div className="px-4 py-3 text-right flex items-center justify-end">
                        <span className="text-xs font-mono text-muted-foreground tabular-nums">
                          ${formatNum(q.low_price)}
                        </span>
                      </div>
                      <div className="px-4 py-3 text-right flex items-center justify-end">
                        <span className="text-xs font-mono text-muted-foreground tabular-nums">
                          ${formatNum(q.previous_close)}
                        </span>
                      </div>
                    </div>

                    {/* Mobile row */}
                    <div className="md:hidden px-4 py-3 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-mono font-black">{stock.ticker}</span>
                        <p className="text-[10px] text-muted-foreground">{stock.name}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-mono font-bold tabular-nums block">
                          ${formatNum(q.current_price)}
                        </span>
                        <span
                          className="text-xs font-mono tabular-nums"
                          style={{ color: changeColor }}
                        >
                          {isPos ? "+" : ""}{formatNum(pct)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Stocks without quotes (just registered) */}
              {stocksNoQuote.map((stock: any) => (
                <div key={stock.id} className="bg-background px-4 py-3 flex items-center justify-between opacity-40">
                  <span className="text-sm font-mono font-black">{stock.ticker}</span>
                  <span className="text-xs font-mono text-muted-foreground">Awaiting quote</span>
                </div>
              ))}
            </div>
          </div>

          {/* Market news */}
          {news.length > 0 && (
            <div>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                Market News — {news.length} articles
              </p>
              <div className="space-y-px bg-border">
                {news.map((article) => (
                  <a
                    key={article.id}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-background flex gap-0 hover:bg-secondary transition-colors group"
                  >
                    {article.image_url ? (
                      <div className="w-20 h-16 shrink-0 overflow-hidden border-r border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={article.image_url}
                          alt=""
                          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                        />
                      </div>
                    ) : (
                      <div className="w-20 h-16 shrink-0 border-r border-border flex items-center justify-center">
                        <span
                          className="text-xs font-mono"
                          style={{ color: "hsl(142 65% 42%)" }}
                        >
                          ◆
                        </span>
                      </div>
                    )}
                    <div className="flex-1 px-4 py-3 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] font-mono uppercase tracking-wider"
                          style={{ color: "hsl(142 65% 42%)" }}
                        >
                          {article.category}
                        </span>
                        {article.source && (
                          <span className="text-[10px] font-mono text-muted-foreground">· {article.source}</span>
                        )}
                        {article.published_at && (
                          <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                            {new Date(article.published_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold leading-snug line-clamp-2 group-hover:underline">
                        {article.headline}
                      </p>
                      {article.related_tickers && article.related_tickers.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {article.related_tickers.slice(0, 5).map((t) => (
                            <span
                              key={t}
                              className="text-[10px] font-mono px-1 bg-secondary"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
