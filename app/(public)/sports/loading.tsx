/** Sports loading shell — mirrors the real page structure. */
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

export default function SportsLoading() {
  return (
    <div className="px-6 py-6 space-y-6">
      <PageHeader />
      <div className="space-y-px bg-border">
        {Array.from({ length: 3 }).map((_, s) => (
          <section key={s} className="bg-background">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <Bar w="w-24" />
              <Bar w="w-32" h="h-2.5" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
              <div className="bg-background p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Bar w="w-32" />
                    <Bar w="w-12" />
                  </div>
                ))}
              </div>
              <div className="bg-background p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Bar key={i} w="w-full" />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
