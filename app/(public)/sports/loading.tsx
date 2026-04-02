/** Sports page loading shell */
export default function SportsLoading() {
  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
      {/* Page header skeleton */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between mb-1">
          <div className="h-8 w-28 bg-secondary rounded animate-pulse" />
          <div className="h-3 w-32 bg-secondary rounded animate-pulse" />
        </div>
        <div className="h-2.5 w-40 bg-secondary rounded animate-pulse" />
      </div>

      {/* League sections */}
      <div className="space-y-px bg-border">
        {Array.from({ length: 4 }).map((_, li) => (
          <section key={li} className="bg-background">
            {/* League header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border border-l-[3px] border-l-secondary">
              <div className="h-3 w-12 bg-secondary rounded animate-pulse" />
              <div className="h-2.5 w-24 bg-secondary rounded animate-pulse" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
              {/* Scores */}
              <div className="bg-background p-4 space-y-3">
                <div className="h-2.5 w-12 bg-secondary rounded animate-pulse" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="py-2 border-b border-border last:border-0">
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-20 bg-secondary rounded animate-pulse" />
                      <div className="h-3 w-12 bg-secondary rounded animate-pulse" />
                      <div className="h-3 w-20 bg-secondary rounded animate-pulse" />
                    </div>
                    <div className="h-2 w-16 bg-secondary rounded animate-pulse mt-1" />
                  </div>
                ))}
              </div>
              {/* News */}
              <div className="bg-background p-4 space-y-3">
                <div className="h-2.5 w-8 bg-secondary rounded animate-pulse" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-14 h-10 bg-secondary rounded animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-full bg-secondary rounded animate-pulse" />
                      <div className="h-3 w-3/4 bg-secondary rounded animate-pulse" />
                      <div className="h-2 w-10 bg-secondary rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
