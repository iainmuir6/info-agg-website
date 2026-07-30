"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LineChart, type ChartPoint } from "@/components/line-chart";
import { formatDate } from "@/lib/format-date";

type Cached = {
  points: ChartPoint[];
  price: number | null;
  pct: number | null;
  name: string | null;
};

const cache = new Map<string, Cached>();

const CARD_W = 260;
/** Only used to decide which side has room; the popup is anchored with a
 *  transform so its real height doesn't need to be known. */
const EST_H = 190;

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
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const [data, setData] = useState<Cached | null>(cache.get(ticker) ?? null);
  const [loading, setLoading] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flush against the hovered cell — no gap, so the cursor can travel from
    // the row onto the popup without crossing dead space and dismissing it.
    // Anchoring with translateY(-100%) when above means the popup's actual
    // height never has to be measured.
    const above = r.top >= EST_H;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - CARD_W / 2),
      window.innerWidth - CARD_W - 8,
    );
    setPos({ left, top: above ? r.top : r.bottom, above });
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
        label: formatDate(q.fetched_at),
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
    // Touch taps emulate mouseenter but frequently never emit mouseleave, so
    // a popup opened here would stay open. Restrict it to real pointers.
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return;
    }
    cancelClose();
    // Short delay so sweeping the cursor across a row doesn't fire a fetch.
    timer.current = setTimeout(() => {
      place();
      setOpen(true);
      load();
    }, 160);
  }

  // Close on a short delay so moving the cursor from the row onto the popup
  // keeps it open; entering the popup cancels the pending close.
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
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
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const pct = data?.pct ?? null;
  const up = (pct ?? 0) >= 0;
  const color = up ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)";

  const popup =
    open && pos ? (
      <div
        role="tooltip"
        className="fixed z-[100] border border-border bg-background shadow-lg"
        style={{
          left: pos.left,
          top: pos.top,
          width: CARD_W,
          transform: pos.above ? "translateY(-100%)" : undefined,
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={hide}
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
      // inline-flex + items-center, not inline-block: the wrapper has no
      // font-size of its own, so it inherits the container's larger one and
      // its line box is taller than the text inside. With inline-block that
      // text sits on the taller strut's baseline and renders visibly lower
      // than sibling items that carry the small size directly.
      className={`tap-row ${wrapperClassName ?? "relative inline-flex items-center"}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => {
        if (
          typeof window !== "undefined" &&
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        ) {
          return;
        }
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
