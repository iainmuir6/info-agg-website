"use client";

import { Children, ReactNode, useSyncExternalStore } from "react";

/** Never let a card get narrower than this — general readability floor for card
 *  content (titles, tickers, score rows). Score rows themselves are always two-up
 *  regardless of width (see `.score-grid` in globals.css); they truncate their own
 *  text under pressure rather than depending on this value. */
const MIN_CARD_PX = 300;
const GAP_PX = 12;   // gap-3
const MAX_COLS = 8;  // sanity ceiling for ultrawide displays

/**
 * Column count derived from available width rather than fixed breakpoints.
 * The old version jumped to 5 columns at exactly 1280px, which made each
 * column ~240px — narrower than a score row needs — so a 1280-1440px laptop
 * showed clipped text. Deriving the count keeps every card >= MIN_CARD_PX and
 * lets very wide screens add columns instead of just stretching.
 */
function getColCount(): number {
  if (typeof window === "undefined") return 1;
  const w = window.innerWidth;
  const pad = w >= 768 ? 32 : 24;            // px-4 from md, px-3 below
  const usable = w - pad + GAP_PX;           // +GAP: n cards have n-1 gaps
  const cols = Math.floor(usable / (MIN_CARD_PX + GAP_PX));
  return Math.min(MAX_COLS, Math.max(1, cols));
}

/**
 * Distributes children into N flex columns using round-robin assignment.
 * Items are pinned to their column — they can never jump to a different one
 * regardless of height changes, unlike CSS `columns` which reflows freely.
 * When a card above collapses, the card directly below slides up smoothly
 * because they share a flex-col container.
 */
/** Width is external state, so it is read through useSyncExternalStore rather
 *  than mirrored into useState from an effect: that keeps SSR (1 column) and
 *  the first client render in sync without the extra mount-then-setState pass,
 *  and drops the resize listener automatically on unmount. */
function subscribeToResize(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

export function MasonryColumns({ children }: { children: ReactNode }) {
  const cols = useSyncExternalStore(subscribeToResize, getColCount, () => 1);

  const items = Children.toArray(children).filter(Boolean);

  if (cols === 1) {
    return <div className="flex flex-col gap-3">{items}</div>;
  }

  // Round-robin: item 0 → col 0, item 1 → col 1, …, item N → col (N % cols)
  const columns: ReactNode[][] = Array.from({ length: cols }, () => []);
  items.forEach((item, i) => columns[i % cols].push(item));

  return (
    <div className="flex gap-3 items-start">
      {columns.map((colItems, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-3 min-w-0">
          {colItems}
        </div>
      ))}
    </div>
  );
}
