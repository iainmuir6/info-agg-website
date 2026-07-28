"use client";

import { usePathname } from "next/navigation";
import { NewsTickerClient, type TickerItem } from "@/components/news-ticker-client";
import { SportsTickerClient, type SportsTickerItem } from "@/components/sports-ticker-client";

/** Market + score tickers. On the Command Center ("/") they are pinned to the
 *  viewport bottom so they're always visible; elsewhere they sit at the end of
 *  the page as a normal footer. */
export function FooterTickers({
  quotes,
  games,
}: {
  quotes: TickerItem[];
  games: SportsTickerItem[];
}) {
  const pathname = usePathname();
  const pinned = pathname === "/";

  return (
    <footer
      className={
        pinned
          ? "sticky bottom-0 z-40 border-t border-border bg-background"
          : "border-t border-border bg-background"
      }
    >
      <NewsTickerClient items={quotes} />
      <SportsTickerClient items={games} />
    </footer>
  );
}
