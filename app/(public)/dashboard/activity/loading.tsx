/** Site activity loading shell — masthead + range picker, four KPI tiles, the
 *  traffic chart beside the at-a-glance rail, then the breakdown grid. */
function Bar({ w = "w-24", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-secondary rounded animate-pulse`} />;
}

function PanelShell({ rows = 6, title = "w-20" }: { rows?: number; title?: string }) {
  return (
    <div className="border border-border">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2">
        <Bar w={title} h="h-2.5" />
        <Bar w="w-12" h="h-2" />
      </div>
      <div className="px-3 py-2 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Bar w={i % 2 ? "w-28" : "w-36"} h="h-2.5" />
            <Bar w="w-16" h="h-2.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ActivityLoading() {
  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <div className="space-y-1.5">
            <Bar w="w-44" h="h-5" />
            <Bar w="w-56" h="h-3" />
          </div>
          <div className="flex items-center gap-3">
            <Bar w="w-40" h="h-7" />
            <Bar w="w-28" h="h-7" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-border px-3 py-2 space-y-1.5">
            <Bar w="w-16" h="h-2" />
            <Bar w="w-20" h="h-6" />
            <Bar w="w-28" h="h-2" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 border border-border">
          <div className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2">
            <Bar w="w-16" h="h-2.5" />
            <Bar w="w-28" h="h-2" />
          </div>
          <div className="h-[280px] m-3 bg-secondary/60 rounded animate-pulse" />
        </div>
        <PanelShell rows={4} title="w-24" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
        {Array.from({ length: 6 }).map((_, i) => (
          <PanelShell key={i} />
        ))}
      </div>
    </div>
  );
}
