import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";

/**
 * Two-pane auth shell. The left pane is the masthead — the same wordmark,
 * section accents and mono status furniture the public header uses — so the
 * login screen reads as part of the paper rather than a generic Supabase
 * starter. It collapses entirely below `lg`; on a phone the form is the page,
 * with a compact masthead bar above it.
 */

const SECTIONS = [
  { label: "NEWS", accent: "hsl(220 90% 52%)" },
  { label: "SPORTS", accent: "hsl(25 95% 50%)" },
  { label: "MARKETS", accent: "hsl(142 65% 42%)" },
  { label: "MEDIA", accent: "hsl(340 78% 50%)" },
  { label: "MISC", accent: "hsl(265 70% 55%)" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background grid lg:grid-cols-[1.05fr_minmax(0,0.95fr)]">
      {/* ---------------------------------------------- brand pane (lg only) */}
      <aside className="hidden lg:flex flex-col justify-center border-r border-border p-10 xl:p-14 relative overflow-hidden">
        {/* Faint newsprint grid. Pure decoration, so it never takes a hit
            slot and is invisible to assistive tech. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.045]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
          }}
        />

        <div className="relative">
          <Link href="/" className="inline-flex flex-col group">
            <span
              className="text-5xl xl:text-6xl font-black tracking-tighter leading-none group-hover:opacity-80 transition-opacity"
              style={{ fontFamily: "Georgia, serif" }}
            >
              INFO HUB
            </span>
          </Link>
          <div className="rule-double mt-4 max-w-md" />
          <p className="mt-4 max-w-md text-[12px] font-mono leading-relaxed text-muted-foreground">
            News, scores, markets, media and the almanac — aggregated once a
            morning and kept warm through the day. Sign in to keep a watchlist,
            favourite teams and a dashboard that opens on what you actually read.
          </p>
        </div>

        <div className="absolute left-10 xl:left-14 right-10 xl:right-14 bottom-10 xl:bottom-14 flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SECTIONS.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: s.accent }}
                  aria-hidden
                />
                <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
                  {s.label}
                </span>
              </span>
            ))}
          </div>
          <p className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground/70">
            Secure sign-in via Supabase Auth
          </p>
        </div>
      </aside>

      {/* ---------------------------------------------------------- form pane */}
      <div className="flex flex-col min-h-screen">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border">
          <Link href="/" className="flex items-center gap-2 group min-w-0">
            <span
              className="lg:hidden text-lg font-black tracking-tighter"
              style={{ fontFamily: "Georgia, serif" }}
            >
              INFO HUB
            </span>
            <span className="hidden lg:inline text-[10px] font-mono tracking-widest uppercase text-muted-foreground group-hover:text-foreground transition-colors">
              ← Back to the front page
            </span>
          </Link>
          <ThemeSwitcher />
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-10 sm:py-14">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
