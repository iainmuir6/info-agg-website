/**
 * Client-safe half of tracked stocks: the cap and the shapes the search route
 * and add route return. The server logic is lib/tracked-stocks.ts.
 */

/**
 * Global cap on user-added (tracked) stocks. Mirrors the trigger in
 * supabase/15_tracked_stocks.sql and TRACKED_STOCKS_CAP in src/api/run_etl.py;
 * change all three together. Why 10: src/api/docs/RATE_LIMITS.md.
 */
export const TRACKED_STOCKS_CAP = 10;

/**
 * - `quoted`: the ETL already quotes it (basket or tracked), favorite directly
 * - `addable`: a US listing nobody tracks yet; Add tracks and favorites it
 * - `favorite`: already in this user's favorites
 */
export type StockSearchStatus = "quoted" | "addable" | "favorite";

export type StockSearchHit = {
  ticker: string;
  name: string;
  stockId: string | null;
  status: StockSearchStatus;
};

export type StockSearchResponse = {
  results: StockSearchHit[];
  tracked: number;
  cap: number;
};

/** Same shape as FavoritesPanel's FavoriteStock, so a new row renders priced. */
export type AddedStock = {
  stock_id: string;
  ticker: string;
  name: string;
  current_price: number | null;
  percent_change: number | null;
};

export type AddStockErrorCode = "invalid" | "full" | "unavailable" | "error";

export type AddStockResult =
  | { ok: true; stock: AddedStock; newlyTracked: boolean; tracked: number }
  | { ok: false; code: AddStockErrorCode; message: string };
