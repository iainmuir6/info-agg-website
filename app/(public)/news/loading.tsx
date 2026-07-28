/** News loading shell — mirrors the real page structure. */
function Bar({ w = "w-24", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-secondary rounded animate-pulse`} />;
}

function PageHeader() {
  return (
    <div>
      <div className="rule-double mb-3" />
      <div className="flex items-baseline justify-between">
        <Bar w="w-40" h="h-6" />
        <Bar w="w-28" h="h-3" />
      </div>
      <div className="mt-2"><Bar w="w-56" h="h-2.5" /></div>
    </div>
  );
}

export default function NewsLoading() {
  return (
    <div className="px-6 py-6 space-y-6">
      <PageHeader />
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Bar key={i} w="w-16" h="h-6" />
        ))}
      </div>
      <div className="space-y-px bg-border border border-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-background px-4 py-3 flex gap-3">
            <div className="flex-1 space-y-2">
              <Bar w="w-3/4" h="h-4" />
              <Bar w="w-1/2" h="h-2.5" />
            </div>
            <div className="w-20 h-14 bg-secondary animate-pulse shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
