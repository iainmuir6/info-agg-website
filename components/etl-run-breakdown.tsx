import {
  DOMAIN_ACCENT,
  DOMAIN_ORDER,
  STATE_COLOR,
  STATE_LABEL,
  type EtlRun,
} from "@/lib/etl-runs";

/**
 * Per-domain breakdown of one ETL run: outcome, counters, errors and notes.
 *
 * Shared by the "Latest ETL Run" panel and the expanded state of a run-history
 * row, so both read identically — the history row is not a second, thinner
 * rendering of the same data.
 */
export function EtlRunBreakdown({
  run,
  maxErrors = 4,
}: {
  run: EtlRun;
  maxErrors?: number;
}) {
  return (
    <div className="divide-y divide-border">
      {DOMAIN_ORDER.map((key) => {
        const d = run.domains[key];
        if (!d) {
          return (
            <div
              key={key}
              className="px-3 py-1.5 flex items-center gap-2 border-l-[3px]"
              style={{ borderLeftColor: "hsl(0 0% 50%)" }}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold w-16 shrink-0">
                {key}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                not part of this run
              </span>
            </div>
          );
        }
        return (
          <div
            key={key}
            className="px-3 py-1.5 border-l-[3px]"
            style={{ borderLeftColor: DOMAIN_ACCENT[key] }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold w-16 shrink-0">
                {key}
              </span>
              <span
                className="text-[9px] font-mono tracking-widest font-bold shrink-0"
                style={{ color: STATE_COLOR[d.state] }}
              >
                {STATE_LABEL[d.state]}
              </span>
              <span className="flex items-center gap-3 flex-wrap min-w-0">
                {d.counters.map((c) => (
                  <span key={c.label} className="text-[10px] font-mono text-muted-foreground">
                    {c.label}{" "}
                    <span className="text-foreground font-bold tabular-nums">
                      {c.count?.toLocaleString() ?? "—"}
                    </span>
                  </span>
                ))}
              </span>
            </div>

            {d.error && (
              <p className="mt-1 text-[10px] font-mono" style={{ color: "hsl(0 72% 50%)" }}>
                ↳ {d.error}
              </p>
            )}
            {d.notes.map((n) => (
              <p key={n} className="mt-1 text-[10px] font-mono text-muted-foreground">
                ↳ {n}
              </p>
            ))}
            {d.errors.slice(0, maxErrors).map((e) => (
              <p
                key={e}
                className="mt-1 text-[10px] font-mono break-words"
                style={{ color: "hsl(45 90% 45%)" }}
              >
                ↳ {e}
              </p>
            ))}
            {d.errors.length > maxErrors && (
              <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                ↳ … and {d.errors.length - maxErrors} more
              </p>
            )}
          </div>
        );
      })}

      <div className="px-3 py-1.5 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase">
          {run.errors.length
            ? `${run.errors.length} error${run.errors.length === 1 ? "" : "s"} recorded`
            : "No errors recorded"}
        </span>
        {run.cleanupTotal != null && (
          <span className="text-[10px] font-mono text-muted-foreground">
            Retention pruned{" "}
            <span className="text-foreground font-bold tabular-nums">
              {run.cleanupTotal.toLocaleString()}
            </span>{" "}
            rows
          </span>
        )}
      </div>
    </div>
  );
}
