/** Team detail page loading shell */
export default function TeamDetailLoading() {
  return (
    <div className="px-6 py-6 max-w-5xl mx-auto space-y-6">
      {/* Back nav */}
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-14 bg-secondary rounded animate-pulse" />
        <div className="h-2.5 w-2 bg-secondary rounded animate-pulse" />
        <div className="h-2.5 w-10 bg-secondary rounded animate-pulse" />
        <div className="h-2.5 w-2 bg-secondary rounded animate-pulse" />
        <div className="h-2.5 w-24 bg-secondary rounded animate-pulse" />
      </div>

      {/* Header */}
      <div>
        <div className="rule-double mb-4" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-9 w-52 bg-secondary rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-3 w-12 bg-secondary rounded animate-pulse" />
              <div className="h-3 w-16 bg-secondary rounded animate-pulse" />
            </div>
          </div>
          <div className="text-right space-y-1.5">
            <div className="h-9 w-20 bg-secondary rounded animate-pulse ml-auto" />
            <div className="h-2.5 w-28 bg-secondary rounded animate-pulse ml-auto" />
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-px bg-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-background px-4 py-3 space-y-1.5">
            <div className="h-2 w-20 bg-secondary rounded animate-pulse" />
            <div className="h-7 w-8 bg-secondary rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Game rows */}
      <div>
        <div className="h-2.5 w-32 bg-secondary rounded animate-pulse mb-3" />
        <div className="space-y-px bg-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-background px-4 py-3 flex items-center gap-4">
              <div className="w-1 h-10 bg-secondary animate-pulse shrink-0" />
              <div className="flex-1 flex items-center justify-between gap-4">
                <div className="h-4 w-32 bg-secondary rounded animate-pulse" />
                <div className="flex items-center gap-4">
                  <div className="h-6 w-16 bg-secondary rounded animate-pulse" />
                  <div className="space-y-1">
                    <div className="h-2.5 w-10 bg-secondary rounded animate-pulse" />
                    <div className="h-2.5 w-16 bg-secondary rounded animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* News */}
      <div>
        <div className="h-2.5 w-28 bg-secondary rounded animate-pulse mb-3" />
        <div className="space-y-px bg-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-background flex">
              <div className="w-20 h-16 bg-secondary animate-pulse shrink-0 border-r border-border" />
              <div className="flex-1 px-4 py-3 space-y-2">
                <div className="flex gap-2">
                  <div className="h-2.5 w-16 bg-secondary rounded animate-pulse" />
                  <div className="h-2.5 w-16 bg-secondary rounded animate-pulse ml-auto" />
                </div>
                <div className="h-3.5 w-full bg-secondary rounded animate-pulse" />
                <div className="h-3.5 w-4/5 bg-secondary rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
