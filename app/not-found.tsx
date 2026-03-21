import Link from "next/link";
import { Bebas_Neue, IBM_Plex_Mono } from "next/font/google";

const display = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-nf-display",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-nf-mono",
});

export default function NotFound() {
  return (
    <div
      className={`${display.variable} ${mono.variable} relative min-h-[100dvh] overflow-hidden bg-[#030306] text-[#e8e4dc]`}
      style={{ fontFamily: "var(--font-nf-mono), ui-monospace, monospace" }}
    >
      {/* Mesh + vignette */}
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 20% 40%, rgba(88, 28, 135, 0.35), transparent 55%),
            radial-gradient(ellipse 70% 60% at 85% 70%, rgba(14, 165, 233, 0.22), transparent 50%),
            radial-gradient(ellipse 50% 40% at 50% 100%, rgba(234, 179, 8, 0.12), transparent 45%)
          `,
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#030306_78%)]" />

      {/* Noise overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Scanline */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.12]">
        <div className="h-[40%] w-full animate-nf-scan bg-gradient-to-b from-transparent via-cyan-400/30 to-transparent" />
      </div>

      {/* Pulse rings */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="absolute h-[min(90vw,520px)] w-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-500/20 animate-nf-pulse-ring" />
        <div
          className="absolute h-[min(90vw,520px)] w-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-500/15 animate-nf-pulse-ring"
          style={{ animationDelay: "1.3s" }}
        />
        <div
          className="absolute h-[min(90vw,520px)] w-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-400/10 animate-nf-pulse-ring"
          style={{ animationDelay: "2.6s" }}
        />
      </div>

      {/* Grid */}
      <div
        className="pointer-events-none absolute inset-0 animate-nf-drift opacity-[0.11]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(148, 163, 184, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />

      <main className="relative z-10 mx-auto flex min-h-[100dvh] max-w-4xl flex-col justify-center px-6 py-16 md:px-10">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.45em] text-cyan-300/80">
          signal interrupted
        </p>

        <h1
          className="select-none text-[clamp(5.5rem,22vw,14rem)] leading-[0.85] tracking-tight animate-nf-glitch"
          style={{ fontFamily: "var(--font-nf-display), system-ui, sans-serif" }}
        >
          404
        </h1>

        <div className="mt-8 max-w-md border-l-2 border-amber-400/60 pl-5">
          <p className="text-lg leading-relaxed text-slate-300 md:text-xl">
            This endpoint isn&apos;t in the feed. The URL may have moved, or it was never wired into
            the hub.
          </p>
          <p className="mt-3 font-mono text-xs text-slate-500">
            ERR_NO_ROUTE · reference lost in the stack
          </p>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            href="/"
            className="group relative inline-flex items-center justify-center border border-cyan-400/50 bg-cyan-400/10 px-8 py-3 text-sm font-medium uppercase tracking-widest text-cyan-100 transition-colors hover:bg-cyan-400/20 hover:text-white"
          >
            <span className="absolute inset-0 -z-10 bg-gradient-to-r from-cyan-500/0 via-cyan-400/20 to-fuchsia-500/0 opacity-0 transition-opacity group-hover:opacity-100" />
            Command center
          </Link>
          <Link
            href="/news"
            className="text-sm uppercase tracking-widest text-slate-400 underline-offset-4 transition-colors hover:text-slate-200 hover:underline"
          >
            Browse news
          </Link>
        </div>
      </main>
    </div>
  );
}
