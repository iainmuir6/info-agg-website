"use client";

import { useMemo, useState } from "react";

export type ChartPoint = {
  /** X-axis label (date string, maturity, etc.) */
  label: string;
  value: number;
};

type Props = {
  points: ChartPoint[];
  height?: number;
  /** Suffix appended to values in the tooltip / axis (e.g. "%") */
  unit?: string;
  /** Decimal places for value formatting */
  precision?: number;
  color?: string;
  /** Show a filled area under the line */
  area?: boolean;
  /** Y axis starts at zero instead of hugging the data range */
  zeroBaseline?: boolean;
  ariaLabel?: string;
};

/**
 * Interactive SVG line chart: labeled axes with ticks, gridlines, hover
 * crosshair and tooltip. Responsive via viewBox; pointer tracking uses
 * fractional coordinates so it stays accurate at any rendered width.
 */
export function LineChart({
  points,
  height = 220,
  unit = "",
  precision = 2,
  color = "hsl(142 65% 42%)",
  area = true,
  zeroBaseline = false,
  ariaLabel = "Line chart",
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const PAD = { top: 14, right: 16, bottom: 30, left: 46 };
  const w = W - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;

  const { min, max, ticks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = zeroBaseline ? Math.min(0, ...values) : Math.min(...values);
    const rawMax = Math.max(...values);
    const span = rawMax - rawMin || Math.abs(rawMax) || 1;
    const pad = span * 0.12;
    const lo = rawMin - pad;
    const hi = rawMax + pad;
    // ~5 evenly spaced ticks on a "nice" step
    const roughStep = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)));
    const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= roughStep) ?? mag * 10;
    const start = Math.ceil(lo / niceStep) * niceStep;
    const t: number[] = [];
    for (let v = start; v <= hi + 1e-9; v += niceStep) t.push(Number(v.toFixed(10)));
    return { min: lo, max: hi, ticks: t };
  }, [points, zeroBaseline]);

  if (points.length < 2) {
    return (
      <p className="text-[10px] font-mono text-muted-foreground py-6 text-center">
        Not enough data to chart
      </p>
    );
  }

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * w;
  const y = (v: number) => PAD.top + h - ((v - min) / (max - min)) * h;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(PAD.top + h).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + h).toFixed(1)} Z`;

  // X tick labels: first, last, and a few evenly spaced between
  const maxXLabels = Math.min(points.length, 6);
  const xTickIdx = Array.from({ length: maxXLabels }, (_, k) =>
    Math.round((k / (maxXLabels - 1)) * (points.length - 1))
  );

  const fmt = (v: number) => `${v.toFixed(precision)}${unit}`;
  const active = hover != null ? points[hover] : null;

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width; // 0..1 across rendered width
    const svgX = frac * W;
    const rel = (svgX - PAD.left) / w;
    const idx = Math.round(rel * (points.length - 1));
    setHover(idx >= 0 && idx < points.length ? idx : null);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", touchAction: "pan-y" }}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Y gridlines + labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity="0.1"
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="10"
              fontFamily="monospace"
              fill="currentColor"
              fillOpacity="0.55"
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + h}
          stroke="currentColor" strokeOpacity="0.25" />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + h} y2={PAD.top + h}
          stroke="currentColor" strokeOpacity="0.25" />

        {/* X ticks + labels */}
        {xTickIdx.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={PAD.top + h} y2={PAD.top + h + 4}
              stroke="currentColor" strokeOpacity="0.3" />
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="10"
              fontFamily="monospace" fill="currentColor" fillOpacity="0.55">
              {points[i].label}
            </text>
          </g>
        ))}

        {area && <path d={areaPath} fill={color} fillOpacity="0.08" />}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Hover crosshair + marker */}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h}
              stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="4" fill={color} />
          </g>
        )}
      </svg>

      {/* Tooltip — positioned as a percentage of container width */}
      {active && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 border border-border bg-background px-2 py-1 shadow-sm"
          style={{ left: `${((x(hover as number) / W) * 100).toFixed(2)}%` }}
        >
          <p className="text-[9px] font-mono text-muted-foreground leading-none whitespace-nowrap">
            {active.label}
          </p>
          <p className="text-[11px] font-mono font-bold leading-tight tabular-nums whitespace-nowrap">
            {fmt(active.value)}
          </p>
        </div>
      )}
    </div>
  );
}
