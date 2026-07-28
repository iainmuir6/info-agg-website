/** Profile loading shell — mirrors the real page structure. */
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

export default function ProfileLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <Bar w="w-36" h="h-6" />
        <div className="mt-1 border-t-4 border-double border-border" />
      </div>
      {/* Account */}
      <div className="border border-border mb-6">
        <div className="px-4 py-2 border-b border-border"><Bar w="w-20" h="h-2.5" /></div>
        <div className="px-4 py-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Bar w="w-24" h="h-2.5" />
              <Bar w="w-40" />
            </div>
          ))}
        </div>
      </div>
      {/* Layout editor */}
      <div className="border border-border mb-6">
        <div className="px-4 py-2 border-b border-border"><Bar w="w-44" h="h-2.5" /></div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-1.5">
              <Bar w="w-4" h="h-2.5" />
              <div className="flex-1"><Bar w="w-32" /></div>
              <Bar w="w-6" h="h-5" />
              <Bar w="w-6" h="h-5" />
              <Bar w="w-14" h="h-5" />
            </div>
          ))}
        </div>
      </div>
      {/* Watchlists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {Array.from({ length: 2 }).map((_, c) => (
          <div key={c} className="border border-border">
            <div className="px-3 py-1.5 border-b border-border"><Bar w="w-28" h="h-2.5" /></div>
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-3">
                  <Bar w="w-4" h="h-4" />
                  <Bar w="w-28" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
