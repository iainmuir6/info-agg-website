/** Profile loading shell — mirrors the real page structure: inline account
 *  masthead, then a two-column grid with the merged Favorites panel on the
 *  left and the Command Center layout editor in its own right rail. */
function Bar({ w = "w-24", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-secondary rounded animate-pulse`} />;
}

function PanelHeader({ w = "w-28" }: { w?: string }) {
  return (
    <div className="px-3 py-1.5 border-b border-border">
      <Bar w={w} h="h-2.5" />
    </div>
  );
}

export default function ProfileLoading() {
  return (
    <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3">
      {/* Masthead — title + email left, role / member-since / sign-out right */}
      <div>
        <div className="rule-double mb-2" />
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <div className="space-y-1.5">
            <Bar w="w-28" h="h-5" />
            <Bar w="w-44" h="h-3" />
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="space-y-1">
              <Bar w="w-10" h="h-2" />
              <Bar w="w-16" h="h-2.5" />
            </div>
            <div className="space-y-1">
              <Bar w="w-20" h="h-2" />
              <Bar w="w-24" h="h-2.5" />
            </div>
            <Bar w="w-24" h="h-7" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          {/* Favorites — one merged panel of stocks, teams and podcasts */}
          <div className="border border-border">
            <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
              <Bar w="w-20" h="h-2.5" />
              <div className="flex items-center gap-2.5">
                <Bar w="w-14" h="h-2" />
                <Bar w="w-14" h="h-2" />
                <Bar w="w-16" h="h-2" />
              </div>
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2 border-l-[3px] border-border">
                  <Bar w="w-12" />
                  <div className="flex-1"><Bar w="w-32" h="h-2.5" /></div>
                  <Bar w="w-10" h="h-2.5" />
                </div>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-border flex items-center gap-2">
              <Bar w="w-10" h="h-4" />
              <Bar w="w-14" h="h-4" />
              <div className="flex-1"><Bar w="w-full" h="h-6" /></div>
            </div>
          </div>

          {/* Change password */}
          <div className="border border-border">
            <PanelHeader w="w-32" />
            <div className="px-3 py-2.5 flex items-center gap-2">
              <Bar w="w-28" h="h-2.5" />
              <div className="flex-1"><Bar w="w-full" h="h-6" /></div>
              <Bar w="w-14" h="h-6" />
            </div>
          </div>
        </div>

        {/* Command Center layout editor */}
        <div className="border border-border">
          <PanelHeader w="w-40" />
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                <Bar w="w-4" h="h-2.5" />
                <div className="flex-1"><Bar w="w-24" h="h-2.5" /></div>
                <Bar w="w-5" h="h-4" />
                <Bar w="w-5" h="h-4" />
                <Bar w="w-12" h="h-4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
