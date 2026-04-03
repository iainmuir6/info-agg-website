/** Media page loading shell */
export default function MediaLoading() {
  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between mb-1">
          <div className="h-8 w-20 bg-secondary rounded animate-pulse" />
          <div className="h-3 w-32 bg-secondary rounded animate-pulse" />
        </div>
        <div className="h-2.5 w-40 bg-secondary rounded animate-pulse" />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        {/* Spotify column */}
        <div className="bg-background p-4 space-y-4">
          <div className="h-3 w-16 bg-secondary rounded animate-pulse" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-center">
              <div className="w-12 h-12 bg-secondary rounded animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-full bg-secondary rounded animate-pulse" />
                <div className="h-2.5 w-3/4 bg-secondary rounded animate-pulse" />
                <div className="h-2 w-1/2 bg-secondary rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        {/* Reddit column */}
        <div className="bg-background p-4 space-y-3">
          <div className="h-3 w-12 bg-secondary rounded animate-pulse" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1 py-2 border-b border-border last:border-0">
              <div className="flex items-center justify-between">
                <div className="h-2 w-20 bg-secondary rounded animate-pulse" />
                <div className="h-2 w-8 bg-secondary rounded animate-pulse" />
              </div>
              <div className="h-3 w-full bg-secondary rounded animate-pulse" />
              <div className="h-3 w-4/5 bg-secondary rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
