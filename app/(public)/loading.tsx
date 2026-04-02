/** Homepage loading shell — mirrors the 5-col card grid */
function CardSkeleton({ className, half }: { className?: string; half?: boolean }) {
  return (
    <div className={`border border-border bg-card${className ? ` ${className}` : ""}`}>
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-3 bg-secondary animate-pulse" />
          <div className="h-2.5 w-20 bg-secondary rounded animate-pulse" />
        </div>
        <div className="h-2 w-6 bg-secondary rounded animate-pulse" />
      </div>
      <div className={`${half ? "h-36" : "h-72"} overflow-hidden`}>
        {Array.from({ length: half ? 4 : 8 }).map((_, i) => (
          <div key={i} className="px-2 py-1.5 border-b border-border flex items-center gap-2">
            <div className="h-2.5 bg-secondary rounded animate-pulse flex-1" />
            <div className="h-2.5 w-10 bg-secondary rounded animate-pulse shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomepageLoading() {
  return (
    <div className="px-3 md:px-4 py-3 md:py-4">
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3 auto-rows-min">
        {/* Row 1: asset type cards (all potentially compact) */}
        <CardSkeleton half />
        <CardSkeleton half />
        <CardSkeleton half />
        <CardSkeleton half />
        <CardSkeleton />
        {/* Row 2: market news */}
        <CardSkeleton half />
        <CardSkeleton className="xl:col-span-2" />
        <CardSkeleton className="xl:col-span-2" />
        {/* Row 3: NYT */}
        <CardSkeleton className="xl:col-span-2" />
        <CardSkeleton className="xl:col-span-2" />
        <CardSkeleton />
        {/* Sports rows */}
        {Array.from({ length: 7 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
        {/* Spotify */}
        <CardSkeleton className="xl:col-span-3" />
      </div>
    </div>
  );
}
