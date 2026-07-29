/** Team detail page loading shell */
export default function TeamDetailLoading() {
  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-secondary rounded animate-pulse" />
            <div className="flex items-center gap-3">
              <div className="h-3 w-16 bg-secondary rounded animate-pulse" />
              <div className="h-3 w-10 bg-secondary rounded animate-pulse" />
              <div className="h-6 w-20 bg-secondary rounded animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right space-y-1">
              <div className="h-2.5 w-14 bg-secondary rounded animate-pulse ml-auto" />
              <div className="h-7 w-16 bg-secondary rounded animate-pulse ml-auto" />
            </div>
            <div className="h-9 w-20 bg-secondary rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Upcoming + Recent Results, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, col) => (
          <section key={col}>
            <div className="h-2.5 w-24 bg-secondary rounded animate-pulse mb-2" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-background px-2 py-2 space-y-1">
                  <div className="h-2.5 w-full bg-secondary rounded animate-pulse" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
