/** Admin dashboard loading shell — mirrors the real page: inline masthead, then
 *  a two-column grid with the latest-run breakdown, per-domain row counts and
 *  the manual refresh panel on the left, run history in its own right rail. */
function Bar({ w = "w-24", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-secondary rounded animate-pulse`} />;
}

function PanelHeader({ w = "w-28", meta = "w-16" }: { w?: string; meta?: string }) {
  return (
    <div className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2">
      <Bar w={w} h="h-2.5" />
      <Bar w={meta} h="h-2" />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* Masthead — title + email left, last run / runs today / status right */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <div className="space-y-1.5">
            <Bar w="w-52" h="h-5" />
            <Bar w="w-44" h="h-3" />
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            {["w-16", "w-20", "w-14"].map((w) => (
              <div key={w} className="space-y-1">
                <Bar w={w} h="h-2" />
                <Bar w="w-16" h="h-2.5" />
              </div>
            ))}
            <Bar w="w-24" h="h-7" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          {/* Latest run — one row per domain */}
          <div className="border border-border">
            <PanelHeader w="w-32" meta="w-40" />
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2 border-l-[3px] border-border">
                  <Bar w="w-14" h="h-2.5" />
                  <Bar w="w-8" h="h-2.5" />
                  <div className="flex items-center gap-3">
                    <Bar w="w-16" h="h-2.5" />
                    <Bar w="w-20" h="h-2.5" />
                    <Bar w="w-14" h="h-2.5" />
                  </div>
                </div>
              ))}
              <div className="px-3 py-1.5 flex items-center justify-between">
                <Bar w="w-36" h="h-2.5" />
                <Bar w="w-40" h="h-2.5" />
              </div>
            </div>
          </div>

          {/* Stored-data counts, one panel per domain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[2, 3, 1, 1].map((rows, i) => (
              <div key={i} className="border border-border">
                <PanelHeader w="w-20" meta="w-14" />
                <div className="px-3 py-2 flex flex-col gap-1.5">
                  {Array.from({ length: rows }).map((_, j) => (
                    <div key={j} className="flex items-baseline justify-between gap-4">
                      <Bar w="w-24" h="h-2.5" />
                      <Bar w="w-12" h="h-4" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Manual refresh */}
          <div className="border border-border">
            <PanelHeader w="w-28" meta="w-0" />
            <div className="px-3 py-2 flex items-center justify-between gap-3">
              <Bar w="w-72" h="h-2.5" />
              <Bar w="w-28" h="h-7" />
            </div>
          </div>
        </div>

        {/* Run history rail */}
        <div className="border border-border">
          <PanelHeader w="w-24" meta="w-12" />
          <div className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="px-3 py-1.5 flex items-center gap-2 border-l-[3px] border-border">
                <Bar w="w-12" h="h-2.5" />
                <Bar w="w-10" h="h-2.5" />
                <Bar w="w-12" h="h-2.5" />
                <div className="ml-auto"><Bar w="w-8" h="h-2.5" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
