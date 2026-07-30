import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StockChartPanel } from "@/components/stock-chart-panel";
import { ViewportFillRow } from "@/components/viewport-fill-row";
import { FavoriteStockButton } from "@/components/favorite-stock-button";
import { formatDate, formatDateTime, easternDayKey } from "@/lib/format-date";

type QuoteHistory = {
  current_price: number;
  change_amount: number | null;
  percent_change: number;
  high_price: number | null;
  low_price: number | null;
  open_price: number | null;
  previous_close: number | null;
  quote_timestamp: string;
};

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function fmtDate(s: string | null) {
  return formatDateTime(s, true);
}

function fmtDateShort(s: string) {
  return formatDate(s);
}

/** Keep only the latest quote per Eastern calendar day — the intraday tier
 *  refreshes core tickers multiple times a day, so the raw row set can have
 *  several entries for today (and any other actively-refreshed day). Without
 *  this, both the chart and the table showed repeat/near-duplicate points for
 *  the same day instead of one clean point per trading day. */
function latestPerDay(quotes: QuoteHistory[]): QuoteHistory[] {
  const byDay = new Map<string, QuoteHistory>();
  for (const q of quotes) {
    const day = easternDayKey(q.quote_timestamp);
    const existing = byDay.get(day);
    if (!existing || new Date(q.quote_timestamp).getTime() > new Date(existing.quote_timestamp).getTime()) {
      byDay.set(day, q);
    }
  }
  return Array.from(byDay.values()).sort(
    (a, b) => new Date(a.quote_timestamp).getTime() - new Date(b.quote_timestamp).getTime()
  );
}

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const supabase = await createClient();

  // Fetch stock info
  const { data: stock } = await supabase
    .from("stocks")
    .select("id, ticker, name, exchange, industry, asset_type, logo_url")
    .eq("ticker", ticker)
    .single();

  if (!stock) notFound();

  // Fetch historical quotes and company news in parallel. Quotes are fetched
  // newest-first + capped, then reversed — ordering ascending with a LIMIT
  // instead returns the OLDEST rows once a ticker has more than 90 quotes,
  // which silently dropped the most recent ~1-2 weeks for every stock with a
  // full history (not just newly-backfilled ones).
  // Favoriting is signed-in only; the button renders nothing otherwise.
  const { data: claimsData } = await supabase.auth.getClaims();
  const signedIn = !!claimsData?.claims;

  const [quotesRes, newsRes, favoriteRes] = await Promise.all([
    supabase
      .from("stock_quotes")
      .select(
        "current_price, change_amount, percent_change, high_price, low_price, open_price, previous_close, quote_timestamp"
      )
      .eq("stock_id", stock.id)
      .order("quote_timestamp", { ascending: false })
      .limit(120),
    supabase
      .from("company_news")
      .select("id, headline, url, source, published_at, related_tickers, summary")
      .overlaps("related_tickers", [ticker])
      .order("published_at", { ascending: false })
      .limit(20),
    signedIn
      ? supabase.from("watchlist_stocks").select("id").eq("stock_id", stock.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const quotes = latestPerDay(((quotesRes.data ?? []) as QuoteHistory[]).slice().reverse());
  const news = newsRes.data ?? [];
  const favorited = !!favoriteRes?.data;

  // Latest quote is the most recent (last in ascending array)
  const latest = quotes[quotes.length - 1] ?? null;

  const pct = latest ? parseFloat(String(latest.percent_change)) : 0;
  const isPos = pct >= 0;
  const changeColor = isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)";

  const ohlcStats = latest
    ? [
        { label: "Open", value: `$${fmt(latest.open_price)}` },
        { label: "High", value: `$${fmt(latest.high_price)}` },
        { label: "Low", value: `$${fmt(latest.low_price)}` },
        { label: "Prev Close", value: `$${fmt(latest.previous_close)}` },
      ]
    : [];

  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Link
          href="/markets"
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors tracking-wider uppercase"
        >
          ← Markets
        </Link>
        <span className="text-muted-foreground text-[10px] font-mono">/</span>
        <span className="text-[10px] font-mono tracking-wider uppercase">{ticker}</span>
      </div>

      {/* ── Header — ticker/name (left), OHLC (centered), price (right); on
             narrow screens the metrics drop to their own evenly spaced row
             below the ticker/price line ────────────────────────────────── */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-start justify-between gap-4 flex-wrap sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="min-w-0 order-1 sm:order-none">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-black tracking-tight leading-none" style={{ fontFamily: "Georgia, serif" }}>
                <span style={{ color: "hsl(142 65% 42%)" }}>◆</span> {ticker}
              </h1>
              <FavoriteStockButton
                stockId={stock.id}
                ticker={ticker}
                initialFavorited={favorited}
                signedIn={signedIn}
              />
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {stock.name && (
                <span className="text-xs text-muted-foreground truncate">{stock.name}</span>
              )}
              {stock.exchange && (
                <span className="text-[9px] font-mono text-muted-foreground tracking-wider uppercase">
                  {stock.exchange}
                </span>
              )}
              {stock.asset_type && (
                <span className="text-[9px] font-mono px-1 py-0.5 bg-secondary uppercase tracking-wider">
                  {stock.asset_type}
                </span>
              )}
            </div>
          </div>

          {ohlcStats.length > 0 && (
            <div className="order-3 sm:order-none basis-full sm:basis-auto grid grid-cols-4 gap-4 sm:gap-10 sm:justify-self-center">
              {ohlcStats.map(({ label, value }) => (
                <div key={label} className="min-w-0 text-center sm:text-left">
                  <p className="text-[8px] font-mono tracking-widest text-muted-foreground uppercase truncate">
                    {label}
                  </p>
                  <p className="text-xs font-mono font-bold tabular-nums truncate">{value}</p>
                </div>
              ))}
            </div>
          )}

          {latest && (
            <div className="text-right shrink-0 order-2 sm:order-none sm:justify-self-end">
              <p className="text-xl font-mono font-black tabular-nums leading-none">
                ${fmt(latest.current_price)}
              </p>
              <p className="text-xs font-mono font-bold tabular-nums mt-0.5" style={{ color: changeColor }}>
                {isPos ? "+" : ""}
                {fmt(latest.change_amount)} ({isPos ? "+" : ""}
                {pct.toFixed(2)}%)
              </p>
              <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
                As of {fmtDate(latest.quote_timestamp)}
              </p>
            </div>
          )}

          {!latest && <p className="text-xs font-mono text-muted-foreground order-2 sm:order-none">No quote data</p>}
        </div>
      </div>

      {/* ── Chart + quote history, side by side — both are height-bounded so
             the ~100-row table always scrolls inside its panel instead of
             running off the page.

             The `lg:h-[calc(...)]` is the layout that ships in the HTML: it is
             correct before any JS runs, so the first paint is already the right
             size. ViewportFillRow then refines it to the exact measured
             remainder (the header/title block above vary by breakpoint and
             content, so the calc can only ever be close). Below `lg` the
             columns stack and each panel takes a fixed height instead —
             filling the viewport there would strand the second panel. ── */}
      <ViewportFillRow className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch lg:h-[calc(100dvh-15rem)] lg:min-h-[320px] lg:max-h-[720px]">
        {/* Price trend chart — 1W/1M/2M range tabs */}
        <div className="min-w-0 flex flex-col min-h-0 h-[300px] sm:h-[340px] lg:h-auto">
          <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-1.5 shrink-0">
            Price History
          </p>
          {quotes.length >= 2 ? (
            <div className="flex-1 min-h-0">
              <StockChartPanel quotes={quotes} fill />
            </div>
          ) : (
            <div className="border border-border px-4 py-4 flex-1 min-h-0 flex items-center justify-center text-center">
              <p className="text-[10px] font-mono text-muted-foreground">
                Not enough history to display chart — run ETL to accumulate data
              </p>
            </div>
          )}
        </div>

        {/* Quote history table */}
        {quotes.length > 0 && (
          <div className="min-w-0 flex flex-col min-h-0 h-[360px] sm:h-[420px] lg:h-auto">
            <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-1.5 shrink-0">
              Quote History — {quotes.length} entries
            </p>
            <div className="border border-border flex flex-col flex-1 min-h-0">
              <div className="grid grid-cols-6 gap-px bg-border shrink-0">
                {["Date", "Price", "Chg%", "High", "Low", "Open"].map((h) => (
                  <div key={h} className="bg-secondary px-1 py-1 text-center">
                    <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground">
                      {h}
                    </span>
                  </div>
                ))}
              </div>
              {/* One row per day (deduped above) + scroll — every entry is
                  reachable, not just the first page of them. */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="space-y-px bg-border">
                  {[...quotes].reverse().map((q, i) => {
                    const p = parseFloat(String(q.percent_change));
                    const isP = p >= 0;
                    return (
                      <div
                        key={i}
                        className="grid grid-cols-6 gap-px bg-background hover:bg-secondary transition-colors"
                      >
                        <div className="px-1 py-1 text-center">
                          <span className="text-[9px] font-mono whitespace-nowrap">
                            {fmtDateShort(q.quote_timestamp)}
                          </span>
                        </div>
                        <div className="px-1 py-1 text-center">
                          <span className="text-[9px] font-mono font-bold tabular-nums">
                            ${fmt(q.current_price)}
                          </span>
                        </div>
                        <div className="px-1 py-1 text-center">
                          <span
                            className="text-[9px] font-mono tabular-nums"
                            style={{ color: isP ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                          >
                            {isP ? "+" : ""}{p.toFixed(2)}%
                          </span>
                        </div>
                        <div className="px-1 py-1 text-center">
                          <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
                            ${fmt(q.high_price)}
                          </span>
                        </div>
                        <div className="px-1 py-1 text-center">
                          <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
                            ${fmt(q.low_price)}
                          </span>
                        </div>
                        <div className="px-1 py-1 text-center">
                          <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
                            ${fmt(q.open_price)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </ViewportFillRow>

      {/* ── Related News ───────────────────────────────────────────────── */}
      {news.length > 0 && (
        <div>
          <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-1.5">
            Related News — {news.length} articles
          </p>
          <div className="space-y-px bg-border">
            {news.slice(0, 8).map((article: any) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-background flex gap-0 hover:bg-secondary transition-colors group"
              >
                <div className="w-10 shrink-0 border-r border-border flex items-center justify-center">
                  <span
                    className="text-[10px] font-mono"
                    style={{ color: "hsl(142 65% 42%)" }}
                  >
                    ◆
                  </span>
                </div>
                <div className="flex-1 px-2.5 py-1.5 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {article.source && (
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {article.source}
                      </span>
                    )}
                    {article.published_at && (
                      <span className="text-[9px] font-mono text-muted-foreground ml-auto">
                        {fmtDate(article.published_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold leading-snug line-clamp-1 group-hover:underline">
                    {article.headline}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
