/**
 * Pure SVG sparkline — no client JS, renders server-side.
 * Draws a line + subtle filled area showing price trend.
 */
interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Override auto-detected color (green if up, red if down) */
  color?: string;
}

export function SparklineChart({
  data,
  width = 300,
  height = 80,
  className,
  color,
}: SparklineChartProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  if (range === 0) return null;

  const padX = 2;
  const padY = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const pts = data.map((v, i) => ({
    x: padX + (i / (data.length - 1)) * w,
    y: padY + h - ((v - min) / range) * h,
  }));

  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath = [
    `M${pts[0].x.toFixed(1)},${height}`,
    ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${pts[pts.length - 1].x.toFixed(1)},${height}`,
    "Z",
  ].join(" ");

  const isUp = data[data.length - 1] >= data[0];
  const stroke = color ?? (isUp ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ width: "100%", height: "auto" }}
      aria-hidden="true"
    >
      <path d={areaPath} fill={stroke} fillOpacity="0.08" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Latest value dot */}
      <circle
        cx={pts[pts.length - 1].x.toFixed(1)}
        cy={pts[pts.length - 1].y.toFixed(1)}
        r="2.5"
        fill={stroke}
      />
    </svg>
  );
}
