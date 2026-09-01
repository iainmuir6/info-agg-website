/** Homepage loading shell — stands in for the masonry card board.
 *
 *  Two things it has to get roughly right or the swap to real content jumps:
 *  the number of cards (the dashboard renders ~24, not the 11 this used to
 *  draw, so the lower two thirds of a wide screen sat empty) and the column
 *  count (MasonryColumns derives its own from width — see getColCount — so
 *  fixed md/xl breakpoints drifted from it on most screens).
 *
 *  CSS `columns` is fine here where the real board uses flex columns: nothing
 *  collapses or reflows in a skeleton, and it needs no measurement.
 */
function CardSkeleton({ rows = 6, headline = false }: { rows?: number; headline?: boolean }) {
  return (
    <div className="border border-border bg-card break-inside-avoid mb-3">
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-3 bg-secondary animate-pulse" />
          <div className="h-2.5 w-20 bg-secondary rounded animate-pulse" />
          <div className="h-2 w-3 bg-secondary rounded animate-pulse" />
        </div>
        <div className="h-2 w-8 bg-secondary rounded animate-pulse" />
      </div>
      {/* The two briefing cards open with a serif headline rather than a row. */}
      {headline && (
        <div className="px-2 pt-2 pb-1 space-y-1">
          <div className="h-3 w-[85%] bg-secondary rounded animate-pulse" />
          <div className="h-3 w-[60%] bg-secondary rounded animate-pulse" />
        </div>
      )}
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-2 py-1.5 border-b border-border last:border-0 flex items-center gap-2">
            <div className="h-2.5 bg-secondary rounded animate-pulse flex-1" />
            <div className="h-2.5 w-10 bg-secondary rounded animate-pulse shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomepageLoading() {
  // Roughly the live card set: two briefings, seven league cards, the market
  // and news lists, media, and the five misc cards.
  const rowCounts = [
    7, 20, 12, 5, 8, 5, 6, 10, 9, 4, 12, 5, 7, 3, 8, 6, 5, 9, 4, 6, 5, 7, 3, 6,
  ];

  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      {/* Tracks getColCount()'s ~312px-per-column rule closely enough that the
          skeleton and the real board show the same number of columns. */}
      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 min-[1572px]:columns-5 min-[1884px]:columns-6 gap-3">
        {rowCounts.map((rows, i) => (
          <CardSkeleton key={i} rows={rows} headline={i < 2} />
        ))}
      </div>
    </div>
  );
}
