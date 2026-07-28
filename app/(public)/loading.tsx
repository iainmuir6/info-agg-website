/** Homepage loading shell — mirrors the masonry card columns. */
function CardSkeleton({ rows = 6 }: { rows?: number }) {
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
  const rowCounts = [5, 8, 6, 7, 4, 9, 5, 6, 7, 4, 8];
  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      {/* Matches MasonryColumns: 1 col mobile, 3 md, 5 xl */}
      <div className="columns-1 md:columns-3 xl:columns-5 gap-3">
        {rowCounts.map((rows, i) => (
          <CardSkeleton key={i} rows={rows} />
        ))}
      </div>
    </div>
  );
}
