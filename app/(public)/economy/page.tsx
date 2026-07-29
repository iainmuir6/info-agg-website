import { createClient } from "@/lib/supabase/server";
import { LineChart, type ChartPoint } from "@/components/line-chart";

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

const MACRO_CONFIG: Record<string, {
  label: string;
  fmt: (v: number) => string;
  unit?: string;
  precision?: number;
}> = {
  federalFunds: { label: "Fed Funds Rate", fmt: (v) => `${v.toFixed(2)}%`, unit: "%", precision: 2 },
  realGDP: { label: "Real GDP", fmt: (v) => `$${(v / 1000).toFixed(1)}T`, precision: 0 },
  CPI: { label: "CPI", fmt: (v) => v.toFixed(1), precision: 1 },
  unemploymentRate: { label: "Unemployment Rate", fmt: (v) => `${v.toFixed(1)}%`, unit: "%", precision: 1 },
  inflationRate: { label: "Inflation Rate", fmt: (v) => `${v.toFixed(2)}%`, unit: "%", precision: 2 },
  "30YearFixedRateMortgageAverage": { label: "30Y Mortgage Rate", fmt: (v) => `${v.toFixed(2)}%`, unit: "%", precision: 2 },
  initialClaims: { label: "Initial Jobless Claims", fmt: (v) => `${(v / 1000).toFixed(0)}K`, precision: 0 },
};

type EconRow = { indicator_name: string; date: string; value: number };

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
  const spreadRows = tenY.filter((r) => twoYByDate.has(r.date));
  const spreadPoints: ChartPoint[] = spreadRows.map((r) => ({
    label: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: r.value - (twoYByDate.get(r.date) as number),
  }));
  const spreadSeries = spreadPoints.map((p) => p.value);
  const latestSpread = spreadSeries.at(-1);

  const macroKeys = Object.keys(MACRO_CONFIG).filter((k) => (byIndicator[k] ?? []).length > 0);
  const hasData = curvePoints.length >= 2 || macroKeys.length > 0;

  return (
    <div className="px-6 py-6 space-y-8">
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
                <LineChart
                  points={curvePoints.map((p) => ({ label: p.label, value: p.value }))}
                  unit="%"
                  precision={2}
                  ariaLabel="US Treasury yield curve by maturity"
                />
              </div>
              {/* Every maturity as a labeled column — maturity above value */}
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-11 border-t border-border">
                {curvePoints.map((p) => (
                  <div key={p.label} className="px-2 py-2 text-center border-r border-b border-border">
                    <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground leading-none">
                      {p.label}
                    </p>
                    <p className="text-xs font-mono font-bold tabular-nums mt-1">
                      {p.value.toFixed(2)}%
                    </p>
                  </div>
                ))}
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
                <LineChart
                  points={spreadPoints}
                  unit="%"
                  precision={2}
                  zeroBaseline
                  height={180}
                  color={latestSpread != null && latestSpread < 0 ? "hsl(0 72% 50%)" : "hsl(142 65% 42%)"}
                  ariaLabel="10-year minus 2-year Treasury spread history"
                />
              </div>
            </div>
          )}

          {/* Macro indicators with history */}
          {macroKeys.length > 0 && (
            <div>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mb-3">
                Macro Indicators
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border border border-border">
                {macroKeys.map((key) => {
                  const cfg = MACRO_CONFIG[key];
                  const series = byIndicator[key];
                  const latest = series[series.length - 1];
                  const history: ChartPoint[] = series.slice(-40).map((r) => ({
                    label: new Date(r.date).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
                    value: r.value,
                  }));
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
                        <LineChart
                          points={history}
                          height={140}
                          precision={cfg.precision ?? 2}
                          unit={cfg.unit ?? ""}
                          ariaLabel={`${cfg.label} history`}
                        />
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
