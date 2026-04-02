import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SparklineChart } from "@/components/sparkline-chart";

type QuoteHistory = {
  current_price: number;
  change_amount: number | null;
  percent_change: number;
  high_price: number | null;
  low_price: number | null;
  open_price: number | null;
  previous_close: number | null;
  fetched_at: string;
};

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateShort(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  // Fetch historical quotes (ascending for chart) and company news in parallel
  const [quotesRes, newsRes] = await Promise.all([
    supabase
      .from("stock_quotes")
      .select(
        "current_price, change_amount, percent_change, high_price, low_price, open_price, previous_close, fetched_at"
      )
      .eq("stock_id", stock.id)
      .order("fetched_at", { ascending: true })
      .limit(90),
    supabase
      .from("company_news")
      .select("id, headline, url, source, published_at, related_tickers, summary")
      .overlaps("related_tickers", [ticker])
      .order("published_at", { ascending: false })
      .limit(20),
  ]);

  const quotes = (quotesRes.data ?? []) as QuoteHistory[];
  const news = newsRes.data ?? [];

  // Latest quote is the most recent (last in ascending array)
  const latest = quotes[quotes.length - 1] ?? null;
  const sparkData = quotes.map((q) => parseFloat(String(q.current_price)));

  const pct = latest ? parseFloat(String(latest.percent_change)) : 0;
  const isPos = pct >= 0;
  const changeColor = isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)";

  // Compute 30-day high/low from history
  const recentQuotes = quotes.slice(-30);
  const hiLo30 =
    recentQuotes.length > 0
      ? {
          high: Math.max(...recentQuotes.map((q) => parseFloat(String(q.high_price ?? q.current_price)))),
          low: Math.min(...recentQuotes.map((q) => parseFloat(String(q.low_price ?? q.current_price)))),
        }
      : null;

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto space-y-6">
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

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <div className="rule-double mb-4" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-3xl font-black tracking-tight leading-none"
              style={{ fontFamily: "Georgia, serif" }}
            >
              <span style={{ color: "hsl(142 65% 42%)" }}>◆</span> {ticker}
            </h1>
            {stock.name && (
              <p className="text-sm text-muted-foreground mt-1">{stock.name}</p>
            )}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {stock.exchange && (
                <span className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase">
                  {stock.exchange}
                </span>
              )}
              {stock.industry && (
                <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
                  {stock.industry}
                </span>
              )}
              {stock.asset_type && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-secondary uppercase tracking-wider">
                  {stock.asset_type}
                </span>
              )}
            </div>
          </div>

          {latest ? (
            <div className="text-right">
              <p className="text-3xl font-mono font-black tabular-nums">
                ${fmt(latest.current_price)}
              </p>
              <p
                className="text-lg font-mono font-bold tabular-nums"
                style={{ color: changeColor }}
              >
                {isPos ? "+" : ""}
                {fmt(latest.change_amount)} ({isPos ? "+" : ""}
                {pct.toFixed(2)}%)
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                As of {fmtDate(latest.fetched_at)}
              </p>
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground">No quote data</p>
          )}
        </div>
      </div>

      {/* ── OHLC Stats ─────────────────────────────────────────────────── */}
      {latest && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
          {[
            { label: "Open", value: `$${fmt(latest.open_price)}` },
            { label: "High", value: `$${fmt(latest.high_price)}` },
            { label: "Low", value: `$${fmt(latest.low_price)}` },
            { label: "Prev Close", value: `$${fmt(latest.previous_close)}` },
            hiLo30
              ? { label: "30D High", value: `$${fmt(hiLo30.high)}` }
              : { label: "30D High", value: "—" },
            hiLo30
              ? { label: "30D Low", value: `$${fmt(hiLo30.low)}` }
              : { label: "30D Low", value: "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-background px-4 py-3">
              <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-1">
                {label}
              </p>
              <p className="text-sm font-mono font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Price trend chart ───────────────────────────────────────────── */}
      {sparkData.length >= 2 ? (
        <div className="border border-border bg-card">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              Price History ({quotes.length} data points)
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">
              {fmtDateShort(quotes[0].fetched_at)} – {fmtDateShort(quotes[quotes.length - 1].fetched_at)}
            </span>
          </div>
          <div className="px-4 py-4">
            <SparklineChart
              data={sparkData}
              height={120}
              className="w-full"
            />
            {/* Date labels */}
            <div className="flex justify-between mt-1">
              <span className="text-[9px] font-mono text-muted-foreground">
                {fmtDateShort(quotes[0].fetched_at)}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                {fmtDateShort(quotes[Math.floor(quotes.length / 2)].fetched_at)}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                {fmtDateShort(quotes[quotes.length - 1].fetched_at)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card px-4 py-6 text-center">
          <p className="text-[10px] font-mono text-muted-foreground">
            Not enough history to display chart — run ETL to accumulate data
          </p>
        </div>
      )}

      {/* ── Quote history table ─────────────────────────────────────────── */}
      {quotes.length > 0 && (
        <div>
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
            Quote History — {quotes.length} entries
          </p>
          <div className="border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-px bg-border">
              {["Date", "Price", "Chg%", "High", "Low", "Open"].map((h) => (
                <div key={h} className="bg-secondary px-3 py-1.5">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                    {h}
                  </span>
                </div>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto">
              <div className="space-y-px bg-border">
                {[...quotes].reverse().map((q, i) => {
                  const p = parseFloat(String(q.percent_change));
                  const isP = p >= 0;
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-px bg-background hover:bg-secondary transition-colors"
                    >
                      <div className="px-3 py-2">
                        <span className="text-[10px] font-mono">{fmtDateShort(q.fetched_at)}</span>
                      </div>
                      <div className="px-3 py-2 text-right">
                        <span className="text-[10px] font-mono font-bold tabular-nums">
                          ${fmt(q.current_price)}
                        </span>
                      </div>
                      <div className="px-3 py-2 text-right">
                        <span
                          className="text-[10px] font-mono tabular-nums"
                          style={{ color: isP ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                        >
                          {isP ? "+" : ""}{p.toFixed(2)}%
                        </span>
                      </div>
                      <div className="px-3 py-2 text-right">
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                          ${fmt(q.high_price)}
                        </span>
                      </div>
                      <div className="px-3 py-2 text-right">
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                          ${fmt(q.low_price)}
                        </span>
                      </div>
                      <div className="px-3 py-2 text-right">
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
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

      {/* ── Related News ───────────────────────────────────────────────── */}
      {news.length > 0 && (
        <div>
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
            Related News — {news.length} articles
          </p>
          <div className="space-y-px bg-border">
            {news.map((article: any) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-background flex gap-0 hover:bg-secondary transition-colors group"
              >
                <div className="w-16 shrink-0 border-r border-border flex items-center justify-center">
                  <span
                    className="text-xs font-mono"
                    style={{ color: "hsl(142 65% 42%)" }}
                  >
                    ◆
                  </span>
                </div>
                <div className="flex-1 px-4 py-3 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {article.source && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {article.source}
                      </span>
                    )}
                    {article.published_at && (
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        {fmtDate(article.published_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold leading-snug line-clamp-2 group-hover:underline">
                    {article.headline}
                  </p>
                  {article.summary && (
                    <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                      {article.summary}
                    </p>
                  )}
                  {article.related_tickers && article.related_tickers.length > 1 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {(article.related_tickers as string[])
                        .filter((t) => t !== ticker)
                        .slice(0, 4)
                        .map((t) => (
                          <Link
                            key={t}
                            href={`/markets/${t}`}
                            className="text-[9px] font-mono px-1 bg-secondary hover:bg-border"
                          >
                            {t}
                          </Link>
                        ))}
                    </div>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
