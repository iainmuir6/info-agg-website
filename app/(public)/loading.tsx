/** Homepage loading shell — mirrors the 5-col card grid */
function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={`border border-border bg-card${className ? ` ${className}` : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-3 bg-secondary animate-pulse" />
          <div className="h-2.5 w-16 bg-secondary rounded animate-pulse" />
        </div>
        <div className="h-2 w-6 bg-secondary rounded animate-pulse" />
      </div>
      {/* Content rows */}
      <div className="h-72 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="px-2 py-1.5 border-b border-border flex items-center gap-2"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
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
        {/* Row 1: markets */}
        <CardSkeleton className="md:col-span-2 xl:col-span-2" />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        {/* Row 2: news full-width */}
        <CardSkeleton className="md:col-span-3 xl:col-span-5" />
        {/* Row 3-4: sports */}
        {Array.from({ length: 7 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
        {/* Media */}
        <CardSkeleton />
        <CardSkeleton className="xl:col-span-2" />
      </div>
    </div>
  );
}
