import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const FEATURES = [
  { label: "NEWS", desc: "NYT · NewsAPI · Breaking Headlines", accent: "news" },
  { label: "MARKETS", desc: "Stocks · ETFs · Finnhub · Alpha Vantage", accent: "markets" },
  { label: "SPORTS", desc: "ESPN · NFL · NBA · MLB · NHL · EPL", accent: "sports" },
  { label: "MEDIA", desc: "Spotify · Reddit · New Releases · Hot Posts", accent: "media" },
];

const TICKER_ITEMS = [
  "AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "META", "TSLA",
  "SPY", "QQQ", "NFL", "NBA", "MLB", "NHL", "NYT", "ESPN",
  "MARKETS", "BREAKING", "LIVE SCORES", "NEW RELEASES",
];

export default async function Home() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims) {
      redirect("/protected");
    }
  } catch {
    // Continue to landing page on Supabase connection error
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).toUpperCase();

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <main className="min-h-screen bg-foreground text-background overflow-hidden relative">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Top ticker bar */}
      <div className="relative z-10 border-b border-white/10 overflow-hidden h-8 flex items-center">
        <div className="pause-on-hover flex items-center overflow-hidden w-full">
          <div className="animate-ticker" style={{ animationDuration: "35s" }}>
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span key={i} className="inline-flex items-center gap-6 mr-8">
                <span className="text-xs font-mono tracking-widest text-white/40 uppercase">
                  {item}
                </span>
                <span className="text-white/20 text-xs">·</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/10 px-8 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse-dot" />
            <span className="text-xs font-mono tracking-widest text-white/50 uppercase">
              Live
            </span>
          </div>

          <div className="text-center">
            <p className="text-xs font-mono tracking-widest text-white/40">{dateStr}</p>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/auth/login"
              className="text-xs font-mono tracking-wider text-white/60 hover:text-white transition-colors uppercase"
            >
              Sign In
            </Link>
            <Link
              href="/auth/sign-up"
              className="text-xs font-mono tracking-wider px-3 py-1.5 border border-white/30 text-white/80 hover:bg-white hover:text-foreground transition-colors uppercase"
            >
              Get Access
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-6xl mx-auto px-8 pt-20 pb-16">
        {/* Masthead */}
        <div className="mb-2">
          <p className="text-xs font-mono tracking-widest text-white/40 uppercase mb-4">
            Information Aggregator — Est. {now.getFullYear()}
          </p>
          <div className="rule-double mb-6" style={{ borderColor: "rgba(255,255,255,0.15)" }} />
        </div>

        <h1
          className="text-[clamp(3rem,10vw,8rem)] font-black leading-none tracking-tighter text-white mb-4"
          style={{ fontFamily: "Georgia, serif" }}
        >
          YOUR WORLD.
          <br />
          <span className="text-white/30">ONE FEED.</span>
        </h1>

        <div className="rule-double mt-6 mb-10" style={{ borderColor: "rgba(255,255,255,0.15)" }} />

        <div className="flex flex-col sm:flex-row items-start gap-6 mb-16">
          <p className="text-white/50 text-lg max-w-md leading-relaxed font-light">
            Aggregated intelligence across markets, news, sports, and media —
            delivered in a single real-time dashboard.
          </p>
          <Link
            href="/auth/sign-up"
            className="inline-flex items-center gap-3 px-6 py-3 bg-white text-foreground font-mono text-sm tracking-wider uppercase hover:bg-white/90 transition-colors shrink-0"
          >
            <span>Enter →</span>
          </Link>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10">
          {FEATURES.map((feat) => (
            <div
              key={feat.label}
              className="bg-foreground p-6 group hover:bg-white/5 transition-colors"
            >
              <div
                className={`w-8 h-0.5 mb-4 bg-${feat.accent}`}
                style={{
                  backgroundColor:
                    feat.accent === "news"
                      ? "hsl(220 90% 52%)"
                      : feat.accent === "markets"
                      ? "hsl(142 65% 42%)"
                      : feat.accent === "sports"
                      ? "hsl(25 95% 50%)"
                      : "hsl(340 78% 50%)",
                }}
              />
              <p className="text-xs font-mono tracking-widest text-white/80 mb-1 uppercase">
                {feat.label}
              </p>
              <p className="text-xs text-white/30 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Data stream visualization */}
      <section className="relative z-10 border-t border-white/10 px-8 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Mock market data */}
            <div>
              <p className="text-xs font-mono tracking-widest text-white/30 uppercase mb-4">
                Markets — Live
              </p>
              {[
                { t: "AAPL", p: "182.50", c: "+2.3%" },
                { t: "NVDA", p: "875.40", c: "+4.1%" },
                { t: "TSLA", p: "248.10", c: "-0.8%" },
                { t: "MSFT", p: "415.30", c: "+1.2%" },
              ].map((s) => (
                <div
                  key={s.t}
                  className="flex justify-between items-center py-2 border-b border-white/5"
                >
                  <span className="text-xs font-mono text-white/60">{s.t}</span>
                  <span className="text-xs font-mono text-white/40">${s.p}</span>
                  <span
                    className="text-xs font-mono"
                    style={{
                      color: s.c.startsWith("+")
                        ? "hsl(142 65% 42%)"
                        : "hsl(0 72% 50%)",
                    }}
                  >
                    {s.c}
                  </span>
                </div>
              ))}
            </div>

            {/* Mock headlines */}
            <div>
              <p className="text-xs font-mono tracking-widest text-white/30 uppercase mb-4">
                Headlines — Breaking
              </p>
              {[
                "Fed signals rate cut ahead of Q2 earnings",
                "Tech stocks rally on AI infrastructure spend",
                "Championship Finals: Game 7 tonight",
                "New album drops: streams hit 1M in 24h",
              ].map((h, i) => (
                <div key={i} className="py-2 border-b border-white/5 flex gap-3">
                  <span className="text-white/20 font-mono text-xs mt-0.5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-xs text-white/50 leading-relaxed">{h}</p>
                </div>
              ))}
            </div>

            {/* Mock scores */}
            <div>
              <p className="text-xs font-mono tracking-widest text-white/30 uppercase mb-4">
                Sports — Live Scores
              </p>
              {[
                { a: "LAL", as: "108", h: "GSW", hs: "112", s: "FINAL" },
                { a: "KC", as: "24", h: "BUF", hs: "21", s: "FINAL" },
                { a: "NYY", as: "5", h: "BOS", hs: "3", s: "7TH" },
              ].map((g, i) => (
                <div
                  key={i}
                  className="py-2.5 border-b border-white/5"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-3">
                      <span className="text-white/60">{g.a}</span>
                      <span className="text-white/40">{g.as}</span>
                    </div>
                    <span className="text-white/20 text-[10px]">{g.s}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-white/40">{g.hs}</span>
                      <span className="text-white/60">{g.h}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <footer className="relative z-10 border-t border-white/10 px-8 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <p className="text-xs font-mono text-white/20">
            © {now.getFullYear()} Information Aggregator
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="/auth/login"
              className="text-xs font-mono tracking-wider text-white/40 hover:text-white/80 transition-colors uppercase"
            >
              Login
            </Link>
            <Link
              href="/auth/sign-up"
              className="text-xs font-mono tracking-wider text-white/40 hover:text-white/80 transition-colors uppercase"
            >
              Register
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
