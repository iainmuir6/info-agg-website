"use client";

type TickerItem = {
  label: string;
  value: string;
  change: number;
};

export function NewsTickerClient({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;

  // Duplicate for seamless loop
  const doubled = [...items, ...items, ...items];

  return (
    <div className="border-b border-border bg-secondary/30 overflow-hidden h-8 flex items-center">
      <div className="shrink-0 px-3 border-r border-border h-full flex items-center">
        <span className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground">
          Markets
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div
          className="animate-ticker flex items-center gap-0"
          style={{ animationDuration: `${Math.max(30, items.length * 4)}s` }}
        >
          {doubled.map((item, i) => {
            const isPos = item.change >= 0;
            return (
              <span key={i} className="inline-flex items-center gap-2 px-4 shrink-0">
                <span className="text-xs font-mono font-bold">{item.label}</span>
                <span className="text-xs font-mono text-muted-foreground tabular-nums">{item.value}</span>
                <span
                  className="text-xs font-mono tabular-nums"
                  style={{ color: isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                >
                  {isPos ? "▲" : "▼"} {Math.abs(item.change).toFixed(2)}%
                </span>
                <span className="text-muted-foreground/30">·</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
