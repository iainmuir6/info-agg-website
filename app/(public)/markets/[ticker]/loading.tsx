/** Stock detail page loading shell */
export default function StockDetailLoading() {
  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* Back nav */}
      <div className="h-2.5 w-24 bg-secondary rounded animate-pulse" />

      {/* Header */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="h-6 w-20 bg-secondary rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-3 w-32 bg-secondary rounded animate-pulse" />
              <div className="h-3 w-12 bg-secondary rounded animate-pulse" />
              <div className="h-3 w-14 bg-secondary rounded animate-pulse" />
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="h-6 w-24 bg-secondary rounded animate-pulse ml-auto" />
            <div className="h-3.5 w-28 bg-secondary rounded animate-pulse ml-auto" />
            <div className="h-2.5 w-20 bg-secondary rounded animate-pulse ml-auto" />
          </div>
        </div>
      </div>

      {/* OHLC stats */}
      <div className="grid grid-cols-4 gap-px bg-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-background px-2 sm:px-3 py-1.5 space-y-1">
            <div className="h-2 w-10 bg-secondary rounded animate-pulse" />
            <div className="h-3.5 w-14 bg-secondary rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Chart + quote history, side by side — same height budget as the real
          page so the skeleton doesn't collapse into a taller layout on swap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch lg:h-[calc(100dvh-15rem)] lg:min-h-[320px] lg:max-h-[720px]">
        {/* Chart */}
        <div className="min-w-0 flex flex-col min-h-0 h-[300px] sm:h-[340px] lg:h-auto">
          <div className="h-2.5 w-24 bg-secondary rounded animate-pulse mb-1.5 shrink-0" />
          <div className="border border-border bg-card flex flex-col flex-1 min-h-0">
            <div className="px-3 py-1.5 border-b border-border flex items-center justify-between shrink-0">
              <div className="h-3 w-20 bg-secondary rounded animate-pulse" />
              <div className="h-3 w-24 bg-secondary rounded animate-pulse" />
            </div>
            <div className="px-2 py-2 flex-1 min-h-0">
              <div className="h-full bg-secondary/40 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Quote history table */}
        <div className="min-w-0 flex flex-col min-h-0 h-[360px] sm:h-[420px] lg:h-auto">
          <div className="h-2.5 w-32 bg-secondary rounded animate-pulse mb-1.5 shrink-0" />
          <div className="border border-border flex flex-col flex-1 min-h-0">
            <div className="grid grid-cols-6 gap-px bg-border shrink-0">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-secondary px-1 py-1.5" />
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <div className="space-y-px bg-border">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-6 gap-px bg-background">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <div key={j} className="px-1 py-1.5 flex justify-center">
                        <div className="h-2.5 w-8 bg-secondary rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* News */}
      <div className="space-y-px bg-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-background flex">
            <div className="w-10 shrink-0 border-r border-border" />
            <div className="flex-1 px-2.5 py-1.5 space-y-1">
              <div className="flex gap-2">
                <div className="h-2.5 w-14 bg-secondary rounded animate-pulse" />
                <div className="h-2.5 w-14 bg-secondary rounded animate-pulse ml-auto" />
              </div>
              <div className="h-3 w-full bg-secondary rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
