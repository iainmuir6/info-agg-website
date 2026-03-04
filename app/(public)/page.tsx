import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NewsTickerClient } from "@/components/news-ticker-client";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getEquityQuotes(supabase: Awaited<ReturnType<typeof createClient>>) {
  const MAG7 = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "META", "TSLA"];
  try {
    const { data } = await supabase
      .from("stocks")
      .select(`ticker, name, stock_quotes(current_price, percent_change, fetched_at)`)
      .in("ticker", MAG7)
      .eq("is_active", true);

    return (data ?? [])
      .map((s: any) => {
        const quotes = (s.stock_quotes ?? []).sort(
          (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
        );
        return { ticker: s.ticker, name: s.name, quote: quotes[0] ?? null };
      })
      .filter((s: any) => s.quote)
      .sort((a: any, b: any) => MAG7.indexOf(a.ticker) - MAG7.indexOf(b.ticker));
  } catch {
    return [];
  }
}

async function getEtfQuotes(supabase: Awaited<ReturnType<typeof createClient>>) {
  const ETFS = ["SPY", "QQQ", "DIA", "IWM", "VTI"];
  try {
    const { data } = await supabase
      .from("stocks")
      .select(`ticker, name, stock_quotes(current_price, percent_change, fetched_at)`)
      .in("ticker", ETFS)
      .eq("is_active", true);

    return (data ?? [])
      .map((s: any) => {
        const quotes = (s.stock_quotes ?? []).sort(
          (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
        );
        return { ticker: s.ticker, name: s.name, quote: quotes[0] ?? null };
      })
      .filter((s: any) => s.quote);
  } catch {
    return [];
  }
}

async function getCryptoNews(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("market_news")
      .select("id, headline, url, source, published_at, related_tickers")
      .eq("category", "crypto")
      .order("published_at", { ascending: false })
      .limit(5);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getLeagueScores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sport: string,
  league: string,
  limit = 6
) {
  try {
    const { data: leagueRow } = await supabase
      .from("leagues")
      .select("id")
      .eq("sport", sport)
      .eq("league", league)
      .single();
    if (!leagueRow) return [];

    const { data } = await supabase
      .from("sports_scores")
      .select("home_team, away_team, home_score, away_score, status, status_detail, game_date")
      .eq("league_id", leagueRow.id)
      .order("game_date", { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getHeadlines(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("news_articles")
      .select("id, title, section, source, url, published_at, image_url")
      .order("published_at", { ascending: false })
      .limit(8);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getSpotifyReleases(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data } = await supabase
      .from("spotify_releases")
      .select("id, name, artists, album_type, release_date, image_url, external_url")
      .order("release_date", { ascending: false })
      .limit(6);
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Helper components ────────────────────────────────────────────────────────

function ChangeTag({ pct }: { pct: number }) {
  const isPos = pct >= 0;
  return (
    <span
      className="text-xs font-mono font-bold tabular-nums"
      style={{ color: isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
    >
      {isPos ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function CardHeader({
  label,
  accent,
  href,
  count,
}: {
  label: string;
  accent: string;
  href: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 shrink-0" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold" style={{ color: accent }}>
          {label}
        </span>
        {count != null && (
          <span className="text-[10px] font-mono text-muted-foreground">{count}</span>
        )}
      </div>
      <Link
        href={href}
        className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
      >
        All →
      </Link>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-[10px] font-mono text-muted-foreground">{msg}</p>
    </div>
  );
}

function ScoreRow({ game }: { game: any }) {
  const status = (game.status ?? "").toLowerCase();
  const isLive = status.includes("in") || status.includes("progress") || status.includes("live");
  const isFinal = status.includes("final");

  return (
    <div className="px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground w-[38%] truncate">{game.away_team}</span>
        <div className="flex items-center gap-2">
          <span className="font-bold tabular-nums w-6 text-right">{game.away_score ?? "—"}</span>
          <span className="text-muted-foreground text-[10px]">–</span>
          <span className="font-bold tabular-nums w-6">{game.home_score ?? "—"}</span>
        </div>
        <span className="text-muted-foreground w-[38%] truncate text-right">{game.home_team}</span>
      </div>
      {isLive && (
        <div className="flex items-center gap-1 mt-0.5">
          <div className="w-1 h-1 rounded-full animate-pulse-dot" style={{ backgroundColor: "hsl(0 72% 50%)" }} />
          <span className="text-[9px] font-mono" style={{ color: "hsl(0 72% 50%)" }}>
            {game.status_detail ?? "LIVE"}
          </span>
        </div>
      )}
      {isFinal && (
        <p className="text-[9px] font-mono text-muted-foreground mt-0.5">FINAL</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CommandCenter() {
  const supabase = await createClient();

  const [equities, etfs, cryptoNews, nbaScores, nflScores, headlines, spotifyReleases] =
    await Promise.all([
      getEquityQuotes(supabase),
      getEtfQuotes(supabase),
      getCryptoNews(supabase),
      getLeagueScores(supabase, "basketball", "nba"),
      getLeagueScores(supabase, "football", "nfl"),
      getHeadlines(supabase),
      getSpotifyReleases(supabase),
    ]);

  const tickerItems = [
    ...equities.map((s: any) => ({
      label: s.ticker,
      value: `$${parseFloat(s.quote?.current_price ?? 0).toFixed(2)}`,
      change: parseFloat(s.quote?.percent_change ?? 0),
    })),
    ...etfs.map((s: any) => ({
      label: s.ticker,
      value: `$${parseFloat(s.quote?.current_price ?? 0).toFixed(2)}`,
      change: parseFloat(s.quote?.percent_change ?? 0),
    })),
  ];

  const hasEquities = equities.length > 0;
  const hasEtfs = etfs.length > 0;
  const hasCrypto = cryptoNews.length > 0;
  const hasNba = nbaScores.length > 0;
  const hasNfl = nflScores.length > 0;
  const hasHeadlines = headlines.length > 0;
  const hasSpotify = spotifyReleases.length > 0;

  return (
    <div className="flex flex-col">
      {/* ── Market ticker ──────────────────────────────────────────────── */}
      <NewsTickerClient items={tickerItems} />

      {/* ── Page title ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <div className="rule-double mb-4" />
        <div className="flex items-baseline justify-between">
          <h1
            className="text-3xl font-black tracking-tight leading-none"
            style={{ fontFamily: "Georgia, serif" }}
          >
            COMMAND CENTER
          </h1>
          <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
            LIVE DATA
          </span>
        </div>
      </div>

      {/* ── Bento grid ─────────────────────────────────────────────────── */}
      <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-3 auto-rows-min">

        {/* ── ROW 1: Equities (wide) + ETFs (narrow) ── */}

        {/* Equities card */}
        <div className="md:col-span-5 border border-border bg-card">
          <CardHeader label="Equities" accent="hsl(142 65% 42%)" href="/markets" count={equities.length} />
          {!hasEquities ? (
            <EmptyState msg="Run ETL to sync stock data" />
          ) : (
            <div>
              {equities.map((s: any) => {
                const pct = parseFloat(s.quote.percent_change ?? 0);
                const price = parseFloat(s.quote.current_price ?? 0);
                return (
                  <div
                    key={s.ticker}
                    className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
                  >
                    <span className="text-xs font-mono font-black w-14">{s.ticker}</span>
                    <span className="text-xs text-muted-foreground flex-1 truncate px-2 hidden sm:block">
                      {s.name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono tabular-nums font-bold">${price.toFixed(2)}</span>
                      <ChangeTag pct={pct} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ETFs card */}
        <div className="md:col-span-3 border border-border bg-card">
          <CardHeader label="ETFs" accent="hsl(142 65% 42%)" href="/markets" />
          {!hasEtfs ? (
            <EmptyState msg="No ETF data" />
          ) : (
            <div>
              {etfs.map((s: any) => {
                const pct = parseFloat(s.quote.percent_change ?? 0);
                const price = parseFloat(s.quote.current_price ?? 0);
                return (
                  <div
                    key={s.ticker}
                    className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
                  >
                    <span className="text-xs font-mono font-black">{s.ticker}</span>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-mono tabular-nums font-bold">${price.toFixed(2)}</span>
                      <ChangeTag pct={pct} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Crypto news card */}
        <div className="md:col-span-4 border border-border bg-card">
          <CardHeader label="Crypto" accent="hsl(45 93% 47%)" href="/markets" />
          {!hasCrypto ? (
            <EmptyState msg="No crypto data" />
          ) : (
            <div>
              {cryptoNews.map((item: any) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:underline">
                    {item.headline}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {item.source && (
                      <span className="text-[10px] font-mono text-muted-foreground">{item.source}</span>
                    )}
                    {(item.related_tickers ?? []).slice(0, 3).map((t: string) => (
                      <span key={t} className="text-[9px] font-mono px-1 bg-secondary" style={{ color: "hsl(45 93% 47%)" }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── ROW 2: NBA + NFL + Spotify ── */}

        {/* NBA scores */}
        <div className="md:col-span-4 border border-border bg-card">
          <CardHeader label="NBA" accent="hsl(25 95% 50%)" href="/sports" count={nbaScores.length} />
          {!hasNba ? (
            <EmptyState msg="No NBA data" />
          ) : (
            nbaScores.map((g: any, i: number) => <ScoreRow key={i} game={g} />)
          )}
        </div>

        {/* NFL scores */}
        <div className="md:col-span-4 border border-border bg-card">
          <CardHeader label="NFL" accent="hsl(25 95% 50%)" href="/sports" count={nflScores.length} />
          {!hasNfl ? (
            <EmptyState msg="No NFL data" />
          ) : (
            nflScores.map((g: any, i: number) => <ScoreRow key={i} game={g} />)
          )}
        </div>

        {/* Spotify new releases */}
        <div className="md:col-span-4 border border-border bg-card">
          <CardHeader label="New Releases" accent="hsl(340 78% 50%)" href="/media" count={spotifyReleases.length} />
          {!hasSpotify ? (
            <EmptyState msg="No Spotify data" />
          ) : (
            <div>
              {spotifyReleases.map((r: any) => (
                <a
                  key={r.id}
                  href={r.external_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.image_url}
                      alt=""
                      className="w-9 h-9 object-cover shrink-0 grayscale group-hover:grayscale-0 transition-all"
                    />
                  ) : (
                    <div className="w-9 h-9 shrink-0 bg-secondary flex items-center justify-center">
                      <span className="text-xs" style={{ color: "hsl(340 78% 50%)" }}>♫</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold line-clamp-1 group-hover:underline">{r.name}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                      {(r.artists ?? []).join(", ")}
                    </p>
                  </div>
                  {r.album_type && (
                    <span
                      className="text-[9px] font-mono uppercase shrink-0 ml-auto"
                      style={{ color: "hsl(340 78% 50%)" }}
                    >
                      {r.album_type}
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── ROW 3: News headlines (full width) ── */}
        <div className="md:col-span-12 border border-border bg-card">
          <CardHeader label="Top Headlines" accent="hsl(220 90% 52%)" href="/news" count={headlines.length} />
          {!hasHeadlines ? (
            <EmptyState msg="Run ETL to sync news data" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
              {headlines.slice(0, 8).map((a: any, i: number) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 p-4 hover:bg-secondary/50 transition-colors group"
                >
                  {a.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.image_url}
                      alt=""
                      className="w-16 h-12 object-cover shrink-0 grayscale group-hover:grayscale-0 transition-all hidden sm:block"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider"
                        style={{ color: "hsl(220 90% 52%)" }}
                      >
                        {a.source}
                      </span>
                      {a.section && (
                        <span className="text-[9px] font-mono text-muted-foreground">· {a.section}</span>
                      )}
                    </div>
                    <p className="text-xs font-bold leading-snug line-clamp-3 group-hover:underline">
                      {a.title}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
