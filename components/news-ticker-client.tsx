"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type TickerItem = {
  label: string;
  value: string;
  change: number;
};

// Shared with the server-side initial fetch in app/(public)/layout.tsx
export const TICKER_MAG7 = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "META", "TSLA"];
export const TICKER_ETFS = ["SPY", "QQQ", "DIA", "IWM", "VTI"];

const POLL_INTERVAL_MS = 60_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeTickerRows(rows: any[], order: string[]): TickerItem[] {
  return (rows ?? [])
    .map((s: any) => {
      const quotes = (s.stock_quotes ?? []).sort(
        (a: any, b: any) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
      );
      const latest = quotes[0];
      if (!latest) return null;
      return {
        label: s.ticker as string,
        value: `$${parseFloat(latest.current_price ?? 0).toFixed(2)}`,
        change: parseFloat(latest.percent_change ?? 0),
      };
    })
    .filter((x): x is TickerItem => x !== null)
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function NewsTickerClient({ items: initialItems }: { items: TickerItem[] }) {
  const [items, setItems] = useState<TickerItem[]>(initialItems);

  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const supabase = createClient();
      const [equitiesRes, etfsRes] = await Promise.all([
        supabase
          .from("stocks")
          .select("ticker, stock_quotes(current_price, percent_change, fetched_at)")
          .in("ticker", TICKER_MAG7)
          .eq("is_active", true),
        supabase
          .from("stocks")
          .select("ticker, stock_quotes(current_price, percent_change, fetched_at)")
          .in("ticker", TICKER_ETFS)
          .eq("is_active", true),
      ]);
      const next = [
        ...normalizeTickerRows(equitiesRes.data ?? [], TICKER_MAG7),
        ...normalizeTickerRows(etfsRes.data ?? [], TICKER_ETFS),
      ];
      if (next.length > 0) setItems(next);
    } catch {
      // keep showing the last good snapshot
    }
  }, []);

  // Poll while the tab is visible; catch up immediately when it becomes visible
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (items.length === 0) return null;

  // Exactly two copies: the keyframe translates -50%, so the second copy
  // slides into the first copy's start position for a seamless loop.
  const looped = [...items, ...items];

  return (
    <div className="border-b border-border bg-secondary/30 overflow-hidden h-8 flex items-center pause-on-hover">
      <div className="shrink-0 px-3 border-r border-border h-full flex items-center">
        <span className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground">
          Markets
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div
          className="animate-ticker flex items-center gap-0"
          style={{ animationDuration: `${Math.max(30, items.length * 4)}s` }}
        >
          {looped.map((item, i) => {
            const isPos = item.change >= 0;
            return (
              <span
                key={i}
                className="inline-flex items-center gap-2 px-4 shrink-0 transition-opacity duration-500"
                aria-hidden={i >= items.length}
              >
                <span className="text-xs font-mono font-bold">{item.label}</span>
                <span className="text-xs font-mono text-muted-foreground tabular-nums">{item.value}</span>
                <span
                  className="text-xs font-mono tabular-nums"
                  style={{ color: isPos ? "hsl(142 65% 42%)" : "hsl(0 72% 50%)" }}
                >
                  {isPos ? "▲" : "▼"} {Math.abs(item.change).toFixed(2)}%
                </span>
                <span className="text-muted-foreground/30">·</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
