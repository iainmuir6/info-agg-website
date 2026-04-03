/** Markets page loading shell */
export default function MarketsLoading() {
  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Page header skeleton */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between mb-1">
          <div className="h-8 w-32 bg-secondary rounded animate-pulse" />
          <div className="h-3 w-24 bg-secondary rounded animate-pulse" />
        </div>
        <div className="h-2.5 w-48 bg-secondary rounded animate-pulse" />
      </div>

      {/* Table header */}
      <div>
        <div className="h-3 w-40 bg-secondary rounded animate-pulse mb-3" />
        <div className="hidden md:grid grid-cols-[120px_1fr_100px_80px_80px_80px_80px_80px] gap-px bg-border mb-px">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-secondary px-4 py-2">
              <div className="h-2.5 w-10 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* Table rows */}
        <div className="space-y-px bg-border">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="bg-background hidden md:grid grid-cols-[120px_1fr_100px_80px_80px_80px_80px_80px] gap-px"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="px-4 py-3">
                <div className="h-4 w-12 bg-secondary rounded animate-pulse" />
              </div>
              <div className="px-4 py-3">
                <div className="h-3 w-28 bg-secondary rounded animate-pulse" />
              </div>
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="px-4 py-3 flex justify-end">
                  <div className="h-4 w-14 bg-secondary rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
