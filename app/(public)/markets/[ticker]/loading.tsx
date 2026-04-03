/** Stock detail page loading shell */
export default function StockDetailLoading() {
  return (
    <div className="px-6 py-6 max-w-5xl mx-auto space-y-6">
      {/* Back nav */}
      <div className="h-2.5 w-24 bg-secondary rounded animate-pulse" />

      {/* Header */}
      <div>
        <div className="rule-double mb-4" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-9 w-28 bg-secondary rounded animate-pulse" />
            <div className="h-3 w-48 bg-secondary rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-4 w-14 bg-secondary rounded animate-pulse" />
              <div className="h-4 w-20 bg-secondary rounded animate-pulse" />
            </div>
          </div>
          <div className="text-right space-y-1.5">
            <div className="h-9 w-28 bg-secondary rounded animate-pulse ml-auto" />
            <div className="h-6 w-36 bg-secondary rounded animate-pulse ml-auto" />
            <div className="h-2.5 w-24 bg-secondary rounded animate-pulse ml-auto" />
          </div>
        </div>
      </div>

      {/* OHLC stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-background px-4 py-3 space-y-1.5">
            <div className="h-2 w-12 bg-secondary rounded animate-pulse" />
            <div className="h-5 w-16 bg-secondary rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="border border-border bg-card">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <div className="h-2.5 w-32 bg-secondary rounded animate-pulse" />
          <div className="h-2.5 w-24 bg-secondary rounded animate-pulse" />
        </div>
        <div className="px-4 py-4">
          <div className="h-28 bg-secondary/40 rounded animate-pulse" />
        </div>
      </div>

      {/* News */}
      <div className="space-y-px bg-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-background flex">
            <div className="w-16 shrink-0 border-r border-border" />
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
  );
}
