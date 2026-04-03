/** News page loading shell */
export default function NewsLoading() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between mb-1">
          <div className="h-8 w-20 bg-secondary rounded animate-pulse" />
          <div className="h-3 w-40 bg-secondary rounded animate-pulse" />
        </div>
        {/* Stats row */}
        <div className="flex gap-4 mt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 w-24 bg-secondary rounded animate-pulse" />
          ))}
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 w-16 bg-secondary rounded animate-pulse" />
        ))}
      </div>

      {/* Article rows */}
      <div className="space-y-px bg-border">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="bg-background flex gap-0"
            style={{ animationDelay: `${i * 0.04}s` }}
          >
            <div className="w-20 h-16 bg-secondary animate-pulse shrink-0 border-r border-border" />
            <div className="flex-1 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-10 bg-secondary rounded animate-pulse" />
                <div className="h-2.5 w-16 bg-secondary rounded animate-pulse" />
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
