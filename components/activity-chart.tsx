"use client";

import { useState } from "react";
import { LineChart, type ChartPoint } from "@/components/line-chart";

type Point = { label: string; pageviews: number; visitors: number };

const METRICS = {
  pageviews: { label: "Page views", color: "hsl(220 90% 56%)" },
  visitors: { label: "Visitors", color: "hsl(142 65% 42%)" },
} as const;

type Metric = keyof typeof METRICS;

/** Traffic over time with a page views / visitors toggle. Switching metric is
 *  client-side — both series arrive with the page, so it costs no refetch. */
export function ActivityChart({ points }: { points: Point[] }) {
  const [metric, setMetric] = useState<Metric>("pageviews");
  const chartPoints: ChartPoint[] = points.map((p) => ({ label: p.label, value: p[metric] }));
  const peak = points.reduce((best, p) => (p[metric] > best[metric] ? p : best), points[0]);

  return (
    <div>
      <div className="px-3 pt-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex border border-border" role="tablist" aria-label="Chart metric">
          {(Object.keys(METRICS) as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={metric === m}
              onClick={() => setMetric(m)}
              className={`text-[9px] font-mono tracking-widest uppercase px-2.5 py-1 transition-colors ${
                metric === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {METRICS[m].label}
            </button>
          ))}
        </div>
        {peak && peak[metric] > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground tracking-wider">
            Peak {peak[metric].toLocaleString()} · {peak.label}
          </span>
        )}
      </div>
      <div className="px-1 pb-1">
        <LineChart
          points={chartPoints}
          height={240}
          precision={0}
          color={METRICS[metric].color}
          zeroBaseline
          ariaLabel={`${METRICS[metric].label} over time`}
        />
      </div>
    </div>
  );
}
