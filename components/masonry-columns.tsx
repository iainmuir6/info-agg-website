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
 * Distributes children into N flex columns of roughly equal height, using
 * caller-supplied height estimates. See packColumns below for how.
 *
 * Cards are assigned to a real column rather than laid out with CSS `columns`,
 * which reflows freely: here a collapsing card lets the card directly below it
 * slide up smoothly instead of the whole board rearranging.
 *
 * Weights are estimates, not measurements. Measuring would mean rendering,
 * measuring, then re-packing, which shows a visible reflow on every load. The
 * card contents are known well enough to estimate (see estimateCardHeight in
 * app/(public)/page.tsx), and being 20px out only ever costs a little balance.
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
  /** Keep this card at the head of whichever column it lands in. */
  top?: boolean;
  /**
   * Reserve this card's column for it alone — nothing else is packed there.
   *
   * For cards tall enough that anything beneath them is pushed below the fold
   * on every other column. Honoured only when the board can afford it — see
   * packColumns — so a narrow screen does not end up with one short column
   * beside two enormous ones.
   */
  exclusive?: boolean;
  /**
   * Keep this card at the foot of whichever column it lands in.
   *
   * Previously this was implied by list position — the misc cards were pinned
   * to the end of HOME_SECTIONS and the packer filled in order, so they came
   * out last by construction. That coupling broke the moment packing stopped
   * being order-dependent (see packColumns), and it was never visible at the
   * call site anyway. Stating it is both clearer and order-independent.
   */
  bottom?: boolean;
};

/** One or more cards that must share a column, treated as a single unit while
 *  packing: a `follow` chain is placed by its combined height so a tall card
 *  plus its follower cannot be split or land somewhere that unbalances the
 *  board. */
type Group = {
  indices: number[];
  weight: number;
  /** Lowest original index in the group — its position in reading order. */
  order: number;
  column?: number;
  top: boolean;
  bottom: boolean;
  exclusive: boolean;
};

/** Index of the shortest column that is open to new cards; ties break
 *  leftmost. Reserved columns are skipped entirely. */
function shortestColumn(heights: number[], reserved: boolean[]): number {
  let target = -1;
  for (let c = 0; c < heights.length; c++) {
    if (reserved[c]) continue;
    if (target === -1 || heights[c] < heights[target]) target = c;
  }
  // Every column reserved is not a state the call sites can reach, but falling
  // back to column 0 beats returning -1 and dropping cards on the floor.
  return target === -1 ? 0 : target;
}

/**
 * Assign cards to columns so the columns come out roughly level.
 *
 * The packer used to walk the cards in editorial order, putting each into
 * whichever column was shortest at that moment. That is only as good as the
 * order it is handed: the tallest cards frequently arrived last, by which point
 * every column was already committed and nothing could absorb them. At six
 * columns — where each holds only three or four cards — one oversized card
 * arriving late left the board visibly ragged.
 *
 * This places the LARGEST cards first instead (longest-processing-time-first,
 * the standard approach to multiway partitioning). Big cards get their pick of
 * empty columns and the small ones fill the gaps they leave, which is what
 * actually levels the columns. Reading order is not lost: it is restored
 * per-column at the end, so each column still runs top-to-bottom in the
 * reader's configured order.
 *
 * `column` and `follow` are the only hints that affect WHICH column a card
 * lands in; `top`/`bottom` affect only its position within that column. That
 * separation is what makes this work. An earlier version of this function
 * held the bottom-anchored cards back for a second placement pass, which
 * sounds harmless but withheld ~1,000px of the board from the balancer and
 * measured *worse* than the naive packer it replaced at four of five column
 * counts. Simulated against the live card set, column spread:
 *
 *     columns:        3     4     5     6     7
 *     in-order:     193   389   683   397   430  px
 *     two-pass:     281   417   453   487   485  px   <- the regression
 *     this:          96    93    48    61    93  px
 */
function packColumns(
  count: number,
  cols: number,
  weights: number[] | undefined,
  hints: PackHint[] | undefined,
): number[][] {
  // ── Build groups: a `follow` card joins the group before it ───────────────
  const groups: Group[] = [];
  for (let i = 0; i < count; i++) {
    const hint = hints?.[i];
    const weight = (weights?.[i] ?? DEFAULT_WEIGHT) + GAP_PX;
    const previous = groups[groups.length - 1];
    if (hint?.follow && previous) {
      previous.indices.push(i);
      previous.weight += weight;
      continue;
    }
    groups.push({
      indices: [i],
      weight,
      order: i,
      column: hint?.column,
      top: !!hint?.top,
      bottom: !!hint?.bottom,
      exclusive: !!hint?.exclusive,
    });
  }

  const columns: number[][][] = Array.from({ length: cols }, () => []);
  const heights = new Array<number>(cols).fill(0);
  const place = (g: Group, target: number) => {
    columns[target].push(g.indices);
    heights[target] += g.weight;
  };

  // 1. Pinned groups have no say in balance, so they go down first and the
  //    rest of the pass balances around the heights they leave behind.
  //    Clamped, not dropped: a card pinned to column 3 still needs a home on a
  //    two-column screen.
  const reserved = new Array<boolean>(cols).fill(false);
  const totalWeight = groups.reduce((n, g) => n + g.weight, 0);
  const pinned = groups.filter((g) => g.column != null);
  for (const g of pinned) {
    const target = Math.min(Math.max(g.column as number, 0), cols - 1);
    place(g, target);

    // Reserving a column costs the rest of the board that column's share of
    // the work, so it is only worth doing when there is enough board to
    // absorb it. Reserve when the remaining columns would come out no more
    // than twice the reserved card's own height; below that the cure is
    // worse than the disease — at three columns the briefings' ~856px would
    // sit beside two columns of ~3,270px, which reads as a bug, not a layout.
    const othersAverage = (totalWeight - g.weight) / Math.max(1, cols - 1);
    if (g.exclusive && cols >= 3 && othersAverage <= g.weight * 2) {
      reserved[target] = true;
    }
  }

  // 2. Everything else, largest first, into whichever column is shortest.
  //    One pass over all of them — see the note above on why holding any
  //    subset back for a later pass makes the result worse, not better.
  for (const g of groups
    .filter((g) => g.column == null)
    .sort((a, b) => b.weight - a.weight)) {
    place(g, shortestColumn(heights, reserved));
  }

  // ── Restore reading order within each column ──────────────────────────────
  // Packing order was "biggest first", which is a layout concern the reader
  // should never see. Sorting each column by original index puts it back, and
  // keeps `follow` pairs adjacent because a follower's index is its
  // predecessor's + 1. `top` and `bottom` groups sort to the ends regardless
  // of index — that is the entire job of those two flags.
  const rankOf = new Map<number, number>();
  for (const g of groups) rankOf.set(g.indices[0], g.top ? 0 : g.bottom ? 2 : 1);

  return columns.map((groupsInColumn) =>
    groupsInColumn
      .slice()
      .sort(
        (a, b) =>
          (rankOf.get(a[0]) ?? 1) - (rankOf.get(b[0]) ?? 1) || a[0] - b[0],
      )
      .flat(),
  );
}

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

  const columns = packColumns(items.length, cols, weights, hints);

  return (
    <div className="flex gap-3 items-start">
      {columns.map((indices, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-3 min-w-0">
          {indices.map((i) => items[i])}
        </div>
      ))}
    </div>
  );
}
