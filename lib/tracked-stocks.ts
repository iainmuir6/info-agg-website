import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  FinnhubUnavailableError,
  searchSymbols,
  validateSymbol,
  type FinnhubQuote,
} from "@/lib/finnhub";
import { normalizeSymbol } from "@/lib/finnhub-utils";
import {
  TRACKED_STOCKS_CAP,
  type AddStockResult,
  type AddedStock,
  type StockSearchHit,
  type StockSearchResponse,
} from "@/lib/tracked-stocks-shared";

/**
 * Tracked stocks: US tickers a signed-in user added beyond baskets.json. The
 * ETL quotes baskets + tracked_stocks (src/api/run_etl.py market_universe).
 *
 * Every write goes through the service role: authenticated has SELECT only
 * on stocks and tracked_stocks, so the Finnhub validation and the DB cap
 * (supabase/15_tracked_stocks.sql) can't be bypassed from the browser.
 *
 * `addTrackedStock` is the one add path. The /api/stocks/track route calls it
 * with the signed-in user's id; a one-off script can call it directly (run
 * tsx with `--conditions=react-server` so `server-only` resolves).
 */

function db() {
  return createServiceRoleClient().schema("info_agg");
}

type Db = ReturnType<typeof db>;

const CAP_ERROR = "tracked_stocks cap reached";

export async function countTracked(client: Db = db()): Promise<number> {
  const { count, error } = await client
    .from("tracked_stocks")
    .select("stock_id", { count: "exact", head: true });
  if (error) throw new Error(`tracked_stocks count failed: ${error.message}`);
  return count ?? 0;
}

type StockRow = { id: string; ticker: string; name: string | null; is_core: boolean };

async function latestQuote(client: Db, stockId: string) {
  const { data } = await client
    .from("stock_quotes")
    .select("current_price, percent_change")
    .eq("stock_id", stockId)
    .order("quote_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    current_price: data?.current_price == null ? null : Number(data.current_price),
    percent_change: data?.percent_change == null ? null : Number(data.percent_change),
  };
}

async function favorite(client: Db, userId: string, stockId: string) {
  return client
    .from("watchlist_stocks")
    .upsert({ user_id: userId, stock_id: stockId }, { onConflict: "user_id,stock_id", ignoreDuplicates: true });
}

const FULL = { ok: false, code: "full", message: `Tracking Full (${TRACKED_STOCKS_CAP}/${TRACKED_STOCKS_CAP})` } as const;

/**
 * Tracks and favorites in one DB transaction under the tracked_stocks lock
 * (info_agg.track_and_favorite, supabase/15), so a concurrent removal can't
 * untrack between the two writes and a crash can't leave a cap slot with no
 * favorite. The cap trigger still applies. Returns the tracked count.
 */
async function trackAndFavorite(
  client: Db,
  userId: string,
  stockId: string,
): Promise<{ tracked: number } | { error: AddStockResult }> {
  const { data, error } = await client.rpc("track_and_favorite", { p_stock: stockId, p_user: userId });
  if (error) {
    if (error.message.includes(CAP_ERROR)) return { error: FULL };
    return { error: { ok: false, code: "error", message: error.message } };
  }
  return { tracked: Number(data ?? 0) };
}

function quoteRow(stockId: string, q: FinnhubQuote) {
  const ts = q.t && q.t > 0 ? new Date(q.t * 1000) : new Date();
  return {
    stock_id: stockId,
    current_price: q.c,
    change_amount: q.d,
    percent_change: q.dp,
    high_price: q.h,
    low_price: q.l,
    open_price: q.o,
    previous_close: q.pc,
    quote_timestamp: ts.toISOString(),
  };
}

/**
 * Adds `symbol` for `userId`: if the ETL already quotes it (basket or
 * tracked) it is just favorited; otherwise it is validated with Finnhub
 * (quote + profile2), its stocks row is created or refreshed, the
 * tracked_stocks row and favorite inserted in one transaction (cap enforced
 * by trigger) and the first quote written. Idempotent: re-adding a tracked
 * favorite is a no-op.
 */
export async function addTrackedStock(symbol: string, userId: string): Promise<AddStockResult> {
  const ticker = normalizeSymbol(symbol);
  if (!ticker) return { ok: false, code: "invalid", message: "Not A US Ticker" };
  if (!userId) return { ok: false, code: "error", message: "Unauthorized" };

  const client = db();

  const { data: existing, error: lookupError } = await client
    .from("stocks")
    .select("id, ticker, name, is_core")
    .eq("ticker", ticker)
    .maybeSingle<StockRow>();
  if (lookupError) return { ok: false, code: "error", message: lookupError.message };

  if (existing) {
    const { data: trackedRow } = await client
      .from("tracked_stocks")
      .select("stock_id")
      .eq("stock_id", existing.id)
      .maybeSingle();
    if (existing.is_core || trackedRow) {
      // Core stocks are never untracked, so a plain favorite is enough. A
      // tracked one goes through the RPC so its tracked row is re-checked
      // (and re-inserted if a removal just untracked it) under the lock.
      let tracked: number;
      if (existing.is_core) {
        const { error } = await favorite(client, userId, existing.id);
        if (error) return { ok: false, code: "error", message: error.message };
        tracked = await countTracked(client);
      } else {
        const res = await trackAndFavorite(client, userId, existing.id);
        if ("error" in res) return res.error;
        tracked = res.tracked;
      }
      const stock: AddedStock = {
        stock_id: existing.id,
        ticker: existing.ticker,
        name: existing.name ?? existing.ticker,
        ...(await latestQuote(client, existing.id)),
      };
      return { ok: true, stock, newlyTracked: false, tracked };
    }
  }

  // Fail fast before spending Finnhub calls; the trigger is the real guard.
  if ((await countTracked(client)) >= TRACKED_STOCKS_CAP) return FULL;

  let validated;
  try {
    validated = await validateSymbol(ticker);
  } catch (e) {
    const message = e instanceof FinnhubUnavailableError ? "Lookup Unavailable" : "Lookup Failed";
    return { ok: false, code: "unavailable", message };
  }
  if (!validated.ok) return { ok: false, code: "invalid", message: validated.reason };
  const v = validated.value;

  // Profile fields only where Finnhub had them, so a refresh never blanks a
  // column an older seed filled. is_core is never written here.
  const profile = Object.fromEntries(
    Object.entries(v.stock).filter(([, val]) => val !== null),
  );
  const { data: upserted, error: stockError } = await client
    .from("stocks")
    .upsert(
      { ticker, asset_type: v.assetType, is_active: true, ...profile },
      { onConflict: "ticker" },
    )
    .select("id, ticker, name")
    .single<{ id: string; ticker: string; name: string | null }>();
  if (stockError || !upserted) {
    return { ok: false, code: "error", message: stockError?.message ?? "Stock write failed" };
  }
  const stockId = upserted.id;

  const res = await trackAndFavorite(client, userId, stockId);
  if ("error" in res) return res.error;

  // The first quote, so the row is priced now rather than at the next ETL
  // slot. A failure here is not fatal: the next Tier A/B run writes one.
  const firstQuote = quoteRow(stockId, v.quote);
  await client.from("stock_quotes").upsert(firstQuote, { onConflict: "stock_id,quote_timestamp" });

  return {
    ok: true,
    stock: {
      stock_id: stockId,
      ticker,
      name: upserted.name ?? v.stock.name,
      current_price: firstQuote.current_price,
      percent_change: firstQuote.percent_change,
    },
    newlyTracked: true,
    tracked: res.tracked,
  };
}

/**
 * The Favorites stock search: quoted local rows (baskets and tracked, which
 * include crypto/forex/commodities Finnhub search doesn't return) merged with
 * Finnhub's US listings. Finnhub failing degrades to local rows only.
 */
export async function searchStocksForUser(query: string, userId: string): Promise<StockSearchResponse> {
  const q = query.trim().toUpperCase().slice(0, 20);
  const client = db();
  if (!q) return { results: [], tracked: await countTracked(client).catch(() => 0), cap: TRACKED_STOCKS_CAP };

  const likeSafe = q.replace(/[%_\\,()]/g, "");
  const [localRes, trackedRes, favRes, finnhubHits] = await Promise.all([
    client
      .from("stocks")
      .select("id, ticker, name, is_core")
      .ilike("ticker", `${likeSafe}%`)
      .eq("is_active", true)
      .order("ticker")
      .limit(25),
    client.from("tracked_stocks").select("stock_id"),
    client.from("watchlist_stocks").select("stock_id").eq("user_id", userId),
    searchSymbols(q).catch(() => []),
  ]);

  const trackedIds = new Set((trackedRes.data ?? []).map((r) => r.stock_id as string));
  const favIds = new Set((favRes.data ?? []).map((r) => r.stock_id as string));
  const local = (localRes.data ?? []) as StockRow[];

  // Finnhub hits that already have a stocks row (any, not only prefix matches).
  const hitTickers = finnhubHits.map((h) => h.symbol).filter((t) => !local.some((l) => l.ticker === t));
  const { data: hitRows } = hitTickers.length
    ? await client.from("stocks").select("id, ticker, name, is_core").in("ticker", hitTickers)
    : { data: [] as StockRow[] };
  const byTicker = new Map<string, StockRow>();
  for (const r of [...local, ...((hitRows ?? []) as StockRow[])]) byTicker.set(r.ticker, r);

  function statusFor(row: StockRow | undefined) {
    if (row && favIds.has(row.id)) return "favorite" as const;
    if (row && (row.is_core || trackedIds.has(row.id))) return "quoted" as const;
    return "addable" as const;
  }

  const results: StockSearchHit[] = [];
  const seen = new Set<string>();
  const push = (hit: StockSearchHit) => {
    if (seen.has(hit.ticker)) return;
    seen.add(hit.ticker);
    results.push(hit);
  };

  // 1. Exact ticker first, wherever it came from.
  // 2. Quoted local rows (what the ETL already follows).
  // 3. Finnhub's US listings in relevance order.
  const exactRow = byTicker.get(q);
  const exactHit = finnhubHits.find((h) => h.symbol === q);
  if (exactRow && (exactRow.is_core || trackedIds.has(exactRow.id))) {
    push({ ticker: q, name: exactRow.name ?? q, stockId: exactRow.id, status: statusFor(exactRow) });
  } else if (exactHit) {
    push({ ticker: q, name: exactHit.description, stockId: exactRow?.id ?? null, status: statusFor(exactRow) });
  }
  for (const r of local) {
    if (r.is_core || trackedIds.has(r.id)) {
      push({ ticker: r.ticker, name: r.name ?? r.ticker, stockId: r.id, status: statusFor(r) });
    }
  }
  for (const h of finnhubHits) {
    const row = byTicker.get(h.symbol);
    push({ ticker: h.symbol, name: row?.name ?? h.description, stockId: row?.id ?? null, status: statusFor(row) });
  }

  return { results: results.slice(0, 8), tracked: trackedIds.size, cap: TRACKED_STOCKS_CAP };
}
