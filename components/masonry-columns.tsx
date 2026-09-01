"use client";

import { Children, ReactNode, useSyncExternalStore } from "react";

/** Never let a card get narrower than this — general readability floor for card
 *  content (titles, tickers, score rows). Score rows themselves are always two-up
 *  regardless of width (see `.score-grid` in globals.css); they truncate their own
 *  text under pressure rather than depending on this value. */
const MIN_CARD_PX = 300;
const GAP_PX = 12;   // gap-3
const MAX_COLS = 8;  // sanity ceiling for ultrawide displays
/** Used when a caller passes no weight for a card. */
const DEFAULT_WEIGHT = 220;

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
 * Distributes children into N flex columns, filling the shortest column first.
 *
 * This used to be plain round-robin (item i -> column i % cols), which ignored
 * how tall the cards actually were: a column that drew three long news lists
 * ran far past one that drew three small ticker grids, and the last column was
 * often nearly empty. Callers now pass a `weights` array of estimated heights
 * and each card goes to whichever column is currently shortest.
 *
 * Items are still pinned to their column — they can never jump to a different
 * one after layout, unlike CSS `columns` which reflows freely — so when a card
 * above collapses, the card directly below still slides up smoothly.
 *
 * Weights are estimates, not measurements: measuring would mean rendering,
 * measuring, then re-packing, which shows a visible reflow on every load. An
 * estimate that is roughly right balances the columns without that cost.
 */
/** Width is external state, so it is read through useSyncExternalStore rather
 *  than mirrored into useState from an effect: that keeps SSR (1 column) and
 *  the first client render in sync without the extra mount-then-setState pass,
 *  and drops the resize listener automatically on unmount. */
function subscribeToResize(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

/** Placement override for a single card.
 *
 *  Height-balancing alone cannot express "this card belongs in column 1" or
 *  "this card sits directly under that one" — both are editorial decisions the
 *  packer has no way to infer, so callers state them explicitly.
 */
export type PackHint = {
  /** Force into this column index (clamped to the current column count). */
  column?: number;
  /** Place in the same column as the previous card, i.e. directly beneath it. */
  follow?: boolean;
};

export function MasonryColumns({
  children,
  weights,
  hints,
}: {
  children: ReactNode;
  /** Estimated height per child, in the same order as `children`. */
  weights?: number[];
  /** Optional placement overrides, in the same order as `children`. */
  hints?: PackHint[];
}) {
  const cols = useSyncExternalStore(subscribeToResize, getColCount, () => 1);

  const items = Children.toArray(children).filter(Boolean);

  if (cols === 1) {
    return <div className="flex flex-col gap-3">{items}</div>;
  }

  const columns: ReactNode[][] = Array.from({ length: cols }, () => []);
  const heights = new Array<number>(cols).fill(0);

  let previousColumn: number | null = null;

  items.forEach((item, i) => {
    const hint = hints?.[i];

    // Ties break to the leftmost column, so with equal weights this degrades
    // to the old round-robin behaviour rather than clumping.
    let target = 0;
    for (let c = 1; c < cols; c++) {
      if (heights[c] < heights[target]) target = c;
    }

    if (hint?.column != null) {
      // Clamp rather than ignore: a card pinned to column 3 still needs a home
      // on a narrow screen showing two columns.
      target = Math.min(Math.max(hint.column, 0), cols - 1);
    } else if (hint?.follow && previousColumn != null) {
      target = previousColumn;
    }

    columns[target].push(item);
    heights[target] += (weights?.[i] ?? DEFAULT_WEIGHT) + GAP_PX;
    previousColumn = target;
  });

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
