"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type WatchlistStock = {
  id: string;
  stock_id: string;
  ticker: string;
  name: string;
  current_price: number | null;
  percent_change: number | null;
};

type Props = {
  initialStocks: WatchlistStock[];
};

export function WatchlistStocks({ initialStocks }: Props) {
  const [stocks, setStocks] = useState<WatchlistStock[]>(initialStocks);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; ticker: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.length < 1) { setSuggestions([]); return; }
    const supabase = createClient();
    const { data } = await supabase
      .from("stocks")
      .select("id, ticker, name")
      .ilike("ticker", `${value}%`)
      .eq("is_active", true)
      .limit(6);
    setSuggestions(data ?? []);
  }

  async function handleAdd(stock: { id: string; ticker: string; name: string }) {
    setAdding(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertError } = await supabase
      .from("watchlist_stocks")
      .insert({ stock_id: stock.id, user_id: user?.id });
    if (insertError) {
      setError(insertError.message);
    } else {
      setStocks((prev) => [
        ...prev,
        { id: "", stock_id: stock.id, ticker: stock.ticker, name: stock.name, current_price: null, percent_change: null },
      ]);
    }
    setSuggestions([]);
    setQuery("");
    setAdding(false);
  }

  async function handleRemove(stockId: string) {
    const supabase = createClient();
    await supabase.from("watchlist_stocks").delete().eq("stock_id", stockId);
    setStocks((prev) => prev.filter((s) => s.stock_id !== stockId));
  }

  return (
    <div className="border border-border">
      <div className="px-3 py-1.5 border-b border-border" style={{ borderLeftColor: "hsl(142 65% 42%)", borderLeftWidth: 3 }}>
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">Tracked Stocks</span>
      </div>

      {stocks.length === 0 ? (
        <p className="px-3 py-4 text-[11px] font-mono text-muted-foreground">
          No stocks tracked yet — add one below
        </p>
      ) : (
        <div className="divide-y divide-border">
          {stocks.map((s) => (
            <div key={s.stock_id} className="px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[11px] font-mono font-bold shrink-0">{s.ticker}</span>
                <span className="text-[10px] font-mono text-muted-foreground truncate">{s.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {s.current_price != null && (
                  <span className="text-[11px] font-mono tabular-nums">
                    ${s.current_price.toFixed(2)}
                  </span>
                )}
                {s.percent_change != null && (
                  <span
                    className="text-[10px] font-mono tabular-nums"
                    style={{ color: s.percent_change >= 0 ? "hsl(142 65% 42%)" : "hsl(0 80% 50%)" }}
                  >
                    {s.percent_change >= 0 ? "+" : ""}{s.percent_change.toFixed(2)}%
                  </span>
                )}
                <button
                  onClick={() => handleRemove(s.stock_id)}
                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="px-3 py-2 border-t border-border relative">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Add ticker…"
            className="flex-1 text-[11px] font-mono bg-transparent border border-border px-2 py-1.5 outline-none focus:border-foreground placeholder:text-muted-foreground"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-10 border border-border bg-background divide-y divide-border shadow-sm">
            {suggestions.map((s) => (
              <button
                key={s.id}
                disabled={adding}
                onClick={() => handleAdd(s)}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted transition-colors disabled:opacity-50"
              >
                <span className="text-[11px] font-mono font-bold">{s.ticker}</span>
                <span className="text-[10px] font-mono text-muted-foreground truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-[10px] font-mono text-red-500 mt-1">{error}</p>}
      </div>
    </div>
  );
}
