"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LineChart, type ChartPoint } from "@/components/line-chart";

type Cached = {
  points: ChartPoint[];
  price: number | null;
  pct: number | null;
  name: string | null;
};

const cache = new Map<string, Cached>();

/**
 * Wraps a ticker link. On hover (or focus) it fetches recent quote history
 * once, caches it, and shows a small popup chart. Renders nothing extra when
 * the ticker has no usable history.
 */
export function TickerHoverChart({
  ticker,
  children,
  className,
  href,
}: {
  ticker: string;
  children: React.ReactNode;
  className?: string;
  href?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Cached | null>(cache.get(ticker) ?? null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    if (cache.has(ticker)) {
      setData(cache.get(ticker)!);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("stocks")
        .select("name, stock_quotes(current_price, percent_change, fetched_at)")
        .eq("ticker", ticker)
        .maybeSingle();

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const quotes = ((rows as any)?.stock_quotes ?? [])
        .slice()
        .sort(
          (a: any, b: any) =>
            new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
        );
      const points: ChartPoint[] = quotes.slice(-40).map((q: any) => ({
        label: new Date(q.fetched_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        value: parseFloat(String(q.current_price)),
      }));
      const last = quotes[quotes.length - 1];
      const payload: Cached = {
        points,
        price: last ? parseFloat(String(last.current_price)) : null,
        pct: last ? parseFloat(String(last.percent_change)) : null,
        name: (rows as any)?.name ?? null,
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      cache.set(ticker, payload);
      setData(payload);
    } catch {
      cache.set(ticker, { points: [], price: null, pct: null, name: null });
    } finally {
      setLoading(false);
    }
  }

  function onEnter() {
    timer.current = setTimeout(() => {
      setOpen(true);
      load();
    }, 180); // small delay so passing the cursor over doesn't fire a fetch
  }

  function onLeave() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }

  const pct = data?.pct ?? null;
  const up = (pct ?? 0) >= 0;

  return (
    <span
      className="relative inline-block"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={() => {
        setOpen(true);
        load();
      }}
      onBlur={onLeave}
    >
      {href ? (
        <Link href={href} className={className}>
          {children}
        </Link>
      ) : (
        <span className={className}>{children}</span>
      )}

      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 z-50 -translate-x-1/2 bottom-full mb-2 block w-64 border border-border bg-background p-2 shadow-lg"
        >
          <span className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[11px] font-mono font-black">{ticker}</span>
            {data?.price != null && (
              <span className="text-[11px] font-mono tabular-nums">
                ${data.price.toFixed(2)}
                {pct != null && (
                  <span
                    className="ml-1 font-bold"
                    style={{ color: up ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                  >
                    {up ? "+" : ""}
                    {pct.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
          </span>
          {data?.name && (
            <span className="block text-[9px] text-muted-foreground truncate mb-1">
              {data.name}
            </span>
          )}
          {loading ? (
            <span className="block h-24 animate-pulse bg-secondary" />
          ) : data && data.points.length >= 2 ? (
            <LineChart
              points={data.points}
              height={130}
              precision={2}
              color={up ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)"}
              ariaLabel={`${ticker} recent price history`}
            />
          ) : (
            <span className="block text-[10px] font-mono text-muted-foreground py-4 text-center">
              No price history yet
            </span>
          )}
        </span>
      )}
    </span>
  );
}
