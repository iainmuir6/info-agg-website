"use client";

import { useEffect, useRef, useState } from "react";
import { NewsTickerClient, type TickerItem } from "@/components/news-ticker-client";
import { SportsTickerClient, type SportsTickerItem } from "@/components/sports-ticker-client";

/**
 * Market + score tickers.
 *
 * The bar is pinned to the viewport bottom with `fixed` on every page (a
 * `sticky bottom-0` last child of the layout's flex column has no room to
 * offset, so it only appeared at the very bottom of the page).
 *
 * The two ticker components are ALWAYS mounted, even when they have no rows
 * to show. Each one renders null while empty but keeps polling, so a moment
 * where the server-rendered snapshot came back empty — a cached fetch failure,
 * or simply no games in the window — repairs itself on the next poll. Bailing
 * out here instead would unmount the pollers and leave the bar gone until the
 * next successful server render.
 *
 * The spacer is measured from the bar rather than hardcoded, so an empty bar
 * collapses to nothing instead of reserving a blank strip.
 */
export function FooterTickers({
  quotes,
  games,
}: {
  quotes: TickerItem[];
  games: SportsTickerItem[];
}) {
  const barRef = useRef<HTMLElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setBarHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tickers = (
    <>
      <NewsTickerClient items={quotes} />
      <SportsTickerClient items={games} />
    </>
  );

  return (
    <>
      <div aria-hidden className="shrink-0" style={{ height: barHeight }} />
      <footer
        ref={barRef}
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background"
      >
        {tickers}
      </footer>
    </>
  );
}
