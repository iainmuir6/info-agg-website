import { createClient } from "@/lib/supabase/server";
import { SparklineChart } from "@/components/sparkline-chart";

// ── Config ────────────────────────────────────────────────────────────────────

const TREASURY_TERMS: { key: string; label: string; years: number }[] = [
  { key: "treasury_1m", label: "1M", years: 1 / 12 },
  { key: "treasury_3m", label: "3M", years: 0.25 },
  { key: "treasury_6m", label: "6M", years: 0.5 },
  { key: "treasury_1y", label: "1Y", years: 1 },
  { key: "treasury_2y", label: "2Y", years: 2 },
  { key: "treasury_3y", label: "3Y", years: 3 },
  { key: "treasury_5y", label: "5Y", years: 5 },
  { key: "treasury_7y", label: "7Y", years: 7 },
  { key: "treasury_10y", label: "10Y", years: 10 },
  { key: "treasury_20y", label: "20Y", years: 20 },
  { key: "treasury_30y", label: "30Y", years: 30 },
];

const MACRO_CONFIG: Record<string, { label: string; fmt: (v: number) => string }> = {
  federalFunds: { label: "Fed Funds Rate", fmt: (v) => `${v.toFixed(2)}%` },
  realGDP: { label: "Real GDP", fmt: (v) => `$${(v / 1000).toFixed(1)}T` },
  CPI: { label: "CPI", fmt: (v) => v.toFixed(1) },
  unemploymentRate: { label: "Unemployment Rate", fmt: (v) => `${v.toFixed(1)}%` },
  inflationRate: { label: "Inflation Rate", fmt: (v) => `${v.toFixed(2)}%` },
  "30YearFixedRateMortgageAverage": { label: "30Y Mortgage Rate", fmt: (v) => `${v.toFixed(2)}%` },
  initialClaims: { label: "Initial Jobless Claims", fmt: (v) => `${(v / 1000).toFixed(0)}K` },
};

type EconRow = { indicator_name: string; date: string; value: number };

// ── Yield curve chart (pure SVG, server-rendered) ────────────────────────────

function YieldCurveChart({ points }: { points: { label: string; value: number }[] }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 220;
  const PAD = { top: 16, right: 24, bottom: 28, left: 40 };
  const w = W - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;

  const values = points.map((p) => p.value);
  const min = Math.floor(Math.min(...values) * 4) / 4 - 0.25;
  const max = Math.ceil(Math.max(...values) * 4) / 4 + 0.25;

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * w;
  const y = (v: number) => PAD.top + h - ((v - min) / (max - min)) * h;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");

  // Horizontal gridlines every 0.5%
  const gridVals: number[] = [];
  for (let v = Math.ceil(min * 2) / 2; v <= max; v += 0.5) gridVals.push(v);

  const accent = "hsl(142 65% 42%)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img"
      aria-label="US Treasury yield curve">
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
            stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
          <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end"
            fontSize="9" fontFamily="monospace" fill="currentColor" fillOpacity="0.5">
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      <path d={linePath} fill="none" stroke={accent} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill={accent} />
          <text x={x(i)} y={H - 10} textAnchor="middle"
            fontSize="9" fontFamily="monospace" fill="currentColor" fillOpacity="0.6">
            {p.label}
          </text>
          <text x={x(i)} y={y(p.value) - 8} textAnchor="middle"
            fontSize="8" fontFamily="monospace" fill="currentColor" fillOpacity="0.8">
            {p.value.toFixed(2)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function EconomyPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("economic_indicators")
    .select("indicator_name, date, value")
    .order("date", { ascending: true });

  const rows: EconRow[] = (data ?? []).map((r) => ({
    indicator_name: r.indicator_name,
    date: r.date,
    value: parseFloat(String(r.value)),
  }));

  const byIndicator = rows.reduce<Record<string, EconRow[]>>((acc, r) => {
    (acc[r.indicator_name] ??= []).push(r);
    return acc;
  }, {});

  // Current yield curve: latest value per term, in maturity order
  const curvePoints = TREASURY_TERMS.flatMap((t) => {
    const series = byIndicator[t.key];
    if (!series || series.length === 0) return [];
    return [{ label: t.label, value: series[series.length - 1].value }];
  });
  const curveDate = byIndicator["treasury_10y"]?.at(-1)?.date;

  // 10Y-2Y spread history (recession watch)
  const tenY = byIndicator["treasury_10y"] ?? [];
  const twoYByDate = new Map((byIndicator["treasury_2y"] ?? []).map((r) => [r.date, r.value]));
  const spreadSeries = tenY
    .filter((r) => twoYByDate.has(r.date))
    .map((r) => r.value - (twoYByDate.get(r.date) as number));
  const latestSpread = spreadSeries.at(-1);

  const macroKeys = Object.keys(MACRO_CONFIG).filter((k) => (byIndicator[k] ?? []).length > 0);
  const hasData = curvePoints.length >= 2 || macroKeys.length > 0;

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-black tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
            <span style={{ color: "hsl(142 65% 42%)" }}>◆</span> ECONOMY
          </h2>
          {curveDate && (
            <span className="text-xs font-mono text-muted-foreground">
              as of {new Date(curveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          FMP · TREASURY RATES · MACRO INDICATORS
        </p>
      </div>

      {!hasData ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">NO ECONOMIC DATA YET</p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <>
          {/* Yield curve */}
          {curvePoints.length >= 2 && (
            <div className="border border-border">
              <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-widest uppercase font-bold">
                  US Treasury Yield Curve
                </span>
                {latestSpread != null && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    10Y–2Y spread:{" "}
                    <span className="font-bold" style={{ color: latestSpread >= 0 ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}>
                      {latestSpread >= 0 ? "+" : ""}{latestSpread.toFixed(2)}%
                    </span>
                  </span>
                )}
              </div>
              <div className="p-4">
                <YieldCurveChart points={curvePoints} />
              </div>
            </div>
          )}

          {/* 10Y-2Y spread history */}
          {spreadSeries.length >= 2 && (
            <div className="border border-border">
              <div className="px-4 py-2 border-b border-border">
                <span className="text-[10px] font-mono tracking-widest uppercase font-bold">
                  10Y–2Y Spread History
                </span>
                <span className="text-[9px] font-mono text-muted-foreground ml-2">
                  negative = inverted curve
                </span>
              </div>
              <div className="p-4">
                <SparklineChart data={spreadSeries} width={640} height={100} />
              </div>
            </div>
          )}

          {/* Macro indicators with history */}
          {macroKeys.length > 0 && (
            <div>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                Macro Indicators
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
                {macroKeys.map((key) => {
                  const cfg = MACRO_CONFIG[key];
                  const series = byIndicator[key];
                  const latest = series[series.length - 1];
                  const history = series.slice(-40).map((r) => r.value);
                  return (
                    <div key={key} className="bg-background p-4">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          {cfg.label}
                        </span>
                        <span className="text-[8px] font-mono text-muted-foreground">
                          {new Date(latest.date).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-xl font-black font-mono tabular-nums mb-2">
                        {cfg.fmt(latest.value)}
                      </p>
                      {history.length >= 2 ? (
                        <SparklineChart data={history} width={220} height={44} />
                      ) : (
                        <p className="text-[9px] font-mono text-muted-foreground">insufficient history</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
