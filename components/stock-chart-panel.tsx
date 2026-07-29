"use client";

import { useMemo, useState } from "react";
import { LineChart, type ChartPoint } from "@/components/line-chart";

type QuotePoint = {
  current_price: number;
  quote_timestamp: string;
};

type Range = "1W" | "1M" | "2M";

// Trading days, not calendar days — quotes are one row per market day
// (deduped to the latest quote per day before this component ever sees them).
const RANGE_DAYS: Record<Range, number> = { "1W": 5, "1M": 21, "2M": 42 };
const RANGE_ORDER: Range[] = ["1W", "1M", "2M"];

/** Compact price chart with 1W/1M/2M range tabs — each tab both windows the
 *  chart and computes its own %-change (first → last close in that window),
 *  distinct from the quote table's day-over-day percent_change. */
export function StockChartPanel({ quotes, fill = false }: { quotes: QuotePoint[]; fill?: boolean }) {
  const [range, setRange] = useState<Range>("1M");

  const { chartPoints, rangePct, windowLabel } = useMemo(() => {
    const days = RANGE_DAYS[range];
    const windowed = quotes.slice(-days);
    const points: ChartPoint[] = windowed.map((q) => ({
      label: new Date(q.quote_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: parseFloat(String(q.current_price)),
    }));
    let pct: number | null = null;
    if (windowed.length >= 2) {
      const first = parseFloat(String(windowed[0].current_price));
      const last = parseFloat(String(windowed[windowed.length - 1].current_price));
      if (first) pct = ((last - first) / first) * 100;
    }
    const label = windowed.length > 0
      ? `${new Date(windowed[0].quote_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(windowed[windowed.length - 1].quote_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "";
    return { chartPoints: points, rangePct: pct, windowLabel: label };
  }, [quotes, range]);

  const isPos = (rangePct ?? 0) >= 0;
  const color = isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)";

  return (
    <div className={`border border-border${fill ? " flex flex-col h-full" : ""}`}>
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-0.5">
          {RANGE_ORDER.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 transition-colors ${
                r === range
                  ? "bg-foreground text-background font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {rangePct != null && (
            <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>
              {isPos ? "+" : ""}{rangePct.toFixed(2)}%
            </span>
          )}
          <span className="text-[9px] font-mono text-muted-foreground">{windowLabel}</span>
        </div>
      </div>
      <div className={`px-2 py-2${fill ? " flex-1 min-h-0" : ""}`}>
        <LineChart
          points={chartPoints}
          precision={2}
          height={300}
          color={color}
          ariaLabel="Price history"
          fill={fill}
        />
      </div>
    </div>
  );
}
