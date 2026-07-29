"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const CARD_W = 260;
const CARD_H = 190;

/**
 * Wraps a ticker. On hover (or keyboard focus) it fetches recent quote history
 * once, caches it, and shows a small popup chart.
 *
 * The popup renders through a portal with fixed positioning: card bodies use
 * `overflow-hidden` so they can collapse, which would clip an absolutely
 * positioned popup inside the card. Fixed + portal escapes every ancestor
 * clipping and scrolling context.
 */
export function TickerHoverChart({
  ticker,
  children,
  className,
  href,
  wrapperClassName,
}: {
  ticker: string;
  children: React.ReactNode;
  className?: string;
  href?: string;
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [data, setData] = useState<Cached | null>(cache.get(ticker) ?? null);
  const [loading, setLoading] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Prefer above the trigger; flip below when there isn't room.
    const top = r.top >= CARD_H + 8 ? r.top - CARD_H - 8 : r.bottom + 8;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - CARD_W / 2),
      window.innerWidth - CARD_W - 8,
    );
    setPos({ left, top });
  }, []);

  const load = useCallback(async () => {
    if (cache.has(ticker)) {
      setData(cache.get(ticker)!);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: row } = await supabase
        .from("stocks")
        .select("name, stock_quotes(current_price, percent_change, fetched_at)")
        .eq("ticker", ticker)
        .maybeSingle();

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const quotes = (((row as any)?.stock_quotes ?? []) as any[])
        .slice()
        .sort(
          (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime(),
        );
      const points: ChartPoint[] = quotes.slice(-40).map((q) => ({
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
        name: ((row as any)?.name as string | null) ?? null,
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      cache.set(ticker, payload);
      setData(payload);
    } catch {
      cache.set(ticker, { points: [], price: null, pct: null, name: null });
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  function show() {
    // Short delay so sweeping the cursor across a row doesn't fire a fetch.
    timer.current = setTimeout(() => {
      place();
      setOpen(true);
      load();
    }, 160);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const pct = data?.pct ?? null;
  const up = (pct ?? 0) >= 0;
  const color = up ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)";

  const popup =
    open && pos ? (
      <div
        role="tooltip"
        className="fixed z-[100] border border-border bg-background shadow-lg pointer-events-none"
        style={{ left: pos.left, top: pos.top, width: CARD_W }}
      >
        <div className="flex items-baseline justify-between gap-2 px-2 py-1 border-b border-border">
          <span className="text-[11px] font-mono font-black">{ticker}</span>
          {data?.price != null && (
            <span className="text-[11px] font-mono tabular-nums">
              ${data.price.toFixed(2)}
              {pct != null && (
                <span className="ml-1 font-bold" style={{ color }}>
                  {up ? "+" : ""}
                  {pct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </div>
        {data?.name && (
          <p className="px-2 pt-1 text-[9px] text-muted-foreground truncate">{data.name}</p>
        )}
        <div className="px-1 pb-1">
          {loading ? (
            <div className="h-[130px] animate-pulse bg-secondary" />
          ) : data && data.points.length >= 2 ? (
            <LineChart
              points={data.points}
              height={130}
              precision={2}
              color={color}
              ariaLabel={`${ticker} recent price history`}
            />
          ) : (
            <p className="text-[10px] font-mono text-muted-foreground py-8 text-center">
              No price history yet
            </p>
          )}
        </div>
      </div>
    ) : null;

  return (
    <span
      ref={anchorRef}
      className={wrapperClassName ?? "relative inline-block"}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => {
        place();
        setOpen(true);
        load();
      }}
      onBlur={hide}
    >
      {href ? (
        <Link href={href} className={className}>
          {children}
        </Link>
      ) : (
        <span className={className}>{children}</span>
      )}
      {typeof document !== "undefined" && popup
        ? createPortal(popup, document.body)
        : null}
    </span>
  );
}
