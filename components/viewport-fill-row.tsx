"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Refines its content's height to fill from wherever it lands down to the
 * bottom of the viewport, measured at runtime rather than guessed via a
 * hardcoded vh/px offset — the sticky header, breadcrumb, and title row above
 * it all vary in height by breakpoint and content, so a static
 * `calc(100vh - Npx)` can only ever be close.
 *
 * This is a REFINEMENT, not the layout: callers must also pass a `lg:h-[…]`
 * class so the height is already sane in the server-rendered HTML. Otherwise
 * the first paint is unbounded and long content (the stock page's ~100-row
 * quote table) dumps its full height onto the page until this runs.
 *
 * Only applies at `lg+`: below that the two-column layout stacks, so filling
 * the full viewport there would strand the second column off-screen.
 */
export function ViewportFillRow({
  children,
  className = "",
  minHeight = 320,
  maxHeight = 720,
  bottomPadding = 24,
}: {
  children: ReactNode;
  className?: string;
  minHeight?: number;
  /** Ceiling on the filled height — a chart stretched across a very tall
   *  display reads as a banner, not a chart. */
  maxHeight?: number;
  bottomPadding?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function recompute() {
      if (!el) return;
      if (window.innerWidth < 1024) {
        setHeight(null);
        return;
      }
      // Document-absolute offset, not `rect.top` alone — on a client-side
      // navigation the browser can still be mid-scroll-restoration from the
      // previous page when this runs, so a viewport-relative `rect.top`
      // bakes in whatever scroll position happened to be current at that
      // instant instead of where the row actually sits on the page.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - bottomPadding;
      setHeight(Math.min(maxHeight, Math.max(minHeight, available)));
    }

    recompute();
    window.addEventListener("resize", recompute);

    // The measured `top` shifts whenever anything above this row reflows —
    // a web font swapping in, the masthead date re-rendering after mount
    // (see components/header-date.tsx), a hydration-driven text change —
    // not just on window resize. Re-measuring on body size changes catches
    // all of those instead of guessing which one fires first; this was the
    // cause of the chart/table sizing correctly only after a hard refresh
    // (font already warm) but not on first load.
    const bodyObserver = new ResizeObserver(() => recompute());
    bodyObserver.observe(document.body);

    return () => {
      window.removeEventListener("resize", recompute);
      bodyObserver.disconnect();
    };
  }, [minHeight, maxHeight, bottomPadding]);

  return (
    <div ref={ref} className={className} style={height != null ? { height } : undefined}>
      {children}
    </div>
  );
}
