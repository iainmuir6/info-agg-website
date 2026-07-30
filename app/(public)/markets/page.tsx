import { createClient } from "@/lib/supabase/server";
import { getFavorites, favoritesFirst } from "@/lib/favorites";
import { FavoriteStar } from "@/components/favorite-star";
import Link from "next/link";
import { TickerHoverChart } from "@/components/ticker-hover-chart";
import { formatDate, formatTime } from "@/lib/format-date";

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
    quote_timestamp: string;
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
    // `!inner` + a per-embed `limit(1)` are both load-bearing, not tidiness.
    // PostgREST caps a response at 1000 rows, and this table has 3,258 active
    // stocks with 5,821 quote rows between them. Selecting every active stock
    // and embedding its FULL quote history blew both caps at once: the stock
    // list was truncated at the 1000th ticker alphabetically, and the embedded
    // quotes ran out after ~36 stocks (A→ECL). Everything past that silently
    // rendered under "Awaiting quote" despite having quotes — and any ticker
    // past the 1000th (e.g. SPCX, 2,696th) never reached the page at all.
    //
    // Driving off the quoted set instead returns all 152 stocks that actually
    // have a quote, one row each, comfortably inside the cap.
    supabase
      .from("stocks")
      .select(`
        id, ticker, name, exchange, industry, logo_url,
        stock_quotes!inner (
          current_price, change_amount, percent_change,
          high_price, low_price, open_price, previous_close, fetched_at, quote_timestamp
        )
      `)
      .eq("is_active", true)
      .order("ticker")
      .order("quote_timestamp", { ascending: false, referencedTable: "stock_quotes" })
      .limit(1, { referencedTable: "stock_quotes" }),
    supabase
      .from("market_news")
      .select("id, category, headline, summary, url, image_url, source, published_at, related_tickers")
      .order("published_at", { ascending: false })
      .limit(30),
  ]);

  // For each stock, get the most recent quote — by quote_timestamp (the
  // trading day/moment it's FOR), not fetched_at (when we pulled it); a
  // historical backfill run after today's live quote would otherwise
  // outrank it since every backfilled row gets a fresh fetched_at.
  const stocks = (stocksRes.data ?? []).map((s: any) => ({
    ...s,
    quote: s.stock_quotes?.sort(
      (a: any, b: any) => new Date(b.quote_timestamp).getTime() - new Date(a.quote_timestamp).getTime()
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
  const { data: claimsData } = await supabase.auth.getClaims();
  const [{ stocks, news }, favorites] = await Promise.all([
    getMarketsData(supabase),
    getFavorites(supabase, claimsData?.claims?.sub as string | undefined),
  ]);

  // Favorites float to the top of the table, keeping the ticker sort within
  // each band.
  const stocksWithQuotes = favoritesFirst(
    stocks.filter((s: any) => s.quote),
    (s: any) => favorites.tickers.has(String(s.ticker).toUpperCase()),
  );
  const latestFetchedAt = stocksWithQuotes.reduce(
    (max: string | null, s: any) =>
      !max || (s.quote.fetched_at && s.quote.fetched_at > max) ? s.quote.fetched_at : max,
    null as string | null,
  );
  const stocksNoQuote = stocks.filter((s: any) => !s.quote);
  const hasData = stocks.length > 0;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-8">
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
          FINNHUB · FMP · ALPHA VANTAGE · INTRADAY SNAPSHOTS
        </p>
      </div>

      {!hasData ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">
            NO MARKET DATA YET
          </p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <>
          {/* Stock quotes table */}
          <div>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
              Watchlist — {stocksWithQuotes.length} quoted
              {latestFetchedAt && (
                <span className="normal-case tracking-normal text-muted-foreground/70">
                  {" "}· as of{" "}
                  {formatTime(latestFetchedAt, true)}
                </span>
              )}
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
                const fav = favorites.tickers.has(String(stock.ticker).toUpperCase());

                return (
                  <Link
                    key={stock.id}
                    href={`/markets/${stock.ticker}`}
                    className={`block bg-background hover:bg-secondary transition-colors animate-fade-in-up${fav ? " favorite-ring" : ""}`}
                    style={{ animationDelay: `${i * 0.03}s` }}
                  >
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-[120px_1fr_100px_80px_80px_80px_80px_80px] gap-0">
                      <div className="px-4 py-3 flex items-center gap-1.5">
                        <span className="text-sm font-mono font-black tracking-tight hover:underline">
                          {stock.ticker}
                        </span>
                        <FavoriteStar show={fav} />
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
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-mono font-black">{stock.ticker}</span>
                          <FavoriteStar show={fav} />
                        </span>
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
                  </Link>
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
                            {formatDate(article.published_at)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold leading-snug line-clamp-2 group-hover:underline">
                        {article.headline}
                      </p>
                      {article.related_tickers && article.related_tickers.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {article.related_tickers.slice(0, 5).map((t) => (
                            <TickerHoverChart
                              key={t}
                              ticker={t}
                              href={`/markets/${t}`}
                              className="text-[10px] font-mono px-1 bg-secondary hover:bg-border"
                            >
                              {t}
                            </TickerHoverChart>
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
