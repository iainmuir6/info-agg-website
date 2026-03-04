import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";

const NAV_LINKS = [
  { href: "/news", label: "NEWS", accent: "hsl(220 90% 52%)" },
  { href: "/sports", label: "SPORTS", accent: "hsl(25 95% 50%)" },
  { href: "/markets", label: "MARKETS", accent: "hsl(142 65% 42%)" },
  { href: "/media", label: "MEDIA", accent: "hsl(340 78% 50%)" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        {/* Masthead */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-border">
          <Link href="/" className="flex flex-col group">
            <span
              className="text-xl font-black tracking-tighter leading-none group-hover:opacity-80 transition-opacity"
              style={{ fontFamily: "Georgia, serif" }}
            >
              INFO HUB
            </span>
            <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
              {dateStr}
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: "hsl(142 65% 42%)" }} />
              <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                Live
              </span>
            </div>
            <Link
              href="/auth/login"
              className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 hover:border-foreground transition-colors"
            >
              Sign In
            </Link>
            <ThemeSwitcher />
          </div>
        </div>

        {/* Category nav */}
        <nav className="px-6 flex items-center overflow-x-auto">
          <Link
            href="/"
            className="px-4 py-2.5 text-xs font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Overview
          </Link>
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="relative px-4 py-2.5 text-xs font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
            >
              {item.label}
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"
                style={{ backgroundColor: item.accent }}
              />
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
          INFORMATION AGGREGATOR
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">{now.getFullYear()}</span>
      </footer>
    </div>
  );
}
