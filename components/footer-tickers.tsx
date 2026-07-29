"use client";

import { usePathname } from "next/navigation";
import { NewsTickerClient, type TickerItem } from "@/components/news-ticker-client";
import { SportsTickerClient, type SportsTickerItem } from "@/components/sports-ticker-client";

/** Height of the two stacked tickers plus their top border. Kept in sync with
 *  TickerShell's h-7/sm:h-8 so the spacer below matches the pinned bar. */
const BAR_H = "h-[57px] sm:h-[65px]";

/**
 * Market + score tickers.
 *
 * On the Command Center ("/") the bar is pinned to the viewport so it is
 * always visible. It uses `fixed` rather than `sticky bottom-0`: as the last
 * child of the layout's `flex flex-col` column, a sticky-bottom element has no
 * room to offset within its containing block, so it only appeared once you
 * scrolled to the very bottom — i.e. never, in practice, on a long homepage.
 * A fixed bar plus an equal-height spacer is deterministic and keeps the last
 * row of cards clear of the bar.
 *
 * Every other page renders the tickers inline at the end of the document.
 */
export function FooterTickers({
  quotes,
  games,
}: {
  quotes: TickerItem[];
  games: SportsTickerItem[];
}) {
  const pathname = usePathname();
  const pinned = pathname === "/";

  // Both ticker components render null when they have no rows; without this
  // the footer would leave a stray border line across the page.
  if (quotes.length === 0 && games.length === 0) return null;

  const tickers = (
    <>
      <NewsTickerClient items={quotes} />
      <SportsTickerClient items={games} />
    </>
  );

  if (!pinned) {
    return (
      <footer className="border-t border-border bg-background">{tickers}</footer>
    );
  }

  return (
    <>
      <div aria-hidden className={`${BAR_H} shrink-0`} />
      <footer className={`fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background ${BAR_H}`}>
        {tickers}
      </footer>
    </>
  );
}
