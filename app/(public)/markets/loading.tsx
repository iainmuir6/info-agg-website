/** Markets loading shell — mirrors the real page structure. */
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

export default function MarketsLoading() {
  return (
    <div className="px-6 py-6 space-y-8">
      <PageHeader />
      <div>
        <div className="mb-3"><Bar w="w-48" h="h-2.5" /></div>
        <div className="space-y-px bg-border border border-border">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-background px-4 py-3 flex items-center gap-4">
              <Bar w="w-16" h="h-4" />
              <div className="flex-1 hidden sm:block"><Bar w="w-40" /></div>
              <Bar w="w-16" />
              <Bar w="w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
