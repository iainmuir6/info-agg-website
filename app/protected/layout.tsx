import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";

const NAV_ITEMS = [
  { href: "/protected", label: "OVERVIEW", exact: true },
  { href: "/protected/news", label: "NEWS", accent: "news" },
  { href: "/protected/sports", label: "SPORTS", accent: "sports" },
  { href: "/protected/markets", label: "MARKETS", accent: "markets" },
  { href: "/protected/media", label: "MEDIA", accent: "media" },
];

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        {/* Masthead row */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-border">
          <Link href="/protected" className="flex flex-col">
            <span
              className="text-xl font-black tracking-tighter leading-none"
              style={{ fontFamily: "Georgia, serif" }}
            >
              INFO HUB
            </span>
            <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
              {dateStr}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-markets animate-pulse-dot" />
              <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                Live
              </span>
            </div>
            <ThemeSwitcher />
          </div>
        </div>

        {/* Navigation row */}
        <nav className="px-6 flex items-center gap-0 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 px-6 py-6 max-w-7xl w-full mx-auto">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
          INFORMATION AGGREGATOR · POWERED BY SUPABASE
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {now.getFullYear()}
        </span>
      </footer>
    </div>
  );
}

// Client-side nav item that detects active route
function NavItem({ item }: { item: (typeof NAV_ITEMS)[0] }) {
  // For server components, we use CSS :active / pathname check via JS
  // Use a simple Link — active state handled via data-pathname in page.tsx wrapping or CSS
  const accentColor =
    item.accent === "news"
      ? "hsl(220 90% 52%)"
      : item.accent === "sports"
      ? "hsl(25 95% 50%)"
      : item.accent === "markets"
      ? "hsl(142 65% 42%)"
      : item.accent === "media"
      ? "hsl(340 78% 50%)"
      : "currentColor";

  return (
    <Link
      href={item.href}
      className="relative px-4 py-2.5 text-xs font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
    >
      {item.label}
      <span
        className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"
        style={{ backgroundColor: accentColor }}
      />
    </Link>
  );
}
