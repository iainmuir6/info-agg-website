/** Media loading shell — mirrors the real page structure. */
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

export default function MediaLoading() {
  return (
    <div className="px-6 py-6 space-y-6">
      <PageHeader />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border border border-border">
        {Array.from({ length: 2 }).map((_, col) => (
          <div key={col} className="bg-background">
            <div className="px-4 py-2 border-b border-border"><Bar w="w-32" h="h-2.5" /></div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-border flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Bar w="w-2/3" />
                  <Bar w="w-1/3" h="h-2.5" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
