import "server-only";
import {
  filterSearchResults,
  isUsExchange,
  normalizeExchange,
  normalizeSymbol,
  type RawSearchResult,
  type SymbolHit,
} from "@/lib/finnhub-utils";

export type { SymbolHit } from "@/lib/finnhub-utils";

/**
 * Finnhub for the Next.js side: symbol search and add-time validation for
 * tracked stocks. The ETL has its own client (src/api/markets/finnhub.py);
 * this one makes at most 3 calls per add and one per search pause.
 *
 * Keys: FINNHUB_API_KEY_1/_2/_3, rotated round-robin over the distinct
 * non-empty values (same rule as the ETL). A 429 on one key retries once on
 * the next. The free tier is 60 calls/min per key, shared with any ETL run
 * in flight; see src/api/docs/RATE_LIMITS.md.
 */

const BASE_URL = "https://finnhub.io/api/v1";
const TIMEOUT_MS = 8000;

function finnhubKeys(): string[] {
  const raw = [
    process.env.FINNHUB_API_KEY_1,
    process.env.FINNHUB_API_KEY_2,
    process.env.FINNHUB_API_KEY_3,
  ];
  return [...new Set(raw.map((k) => k?.trim() ?? "").filter((k) => k.length > 0))];
}

let nextKey = 0;

export class FinnhubUnavailableError extends Error {}

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const keys = finnhubKeys();
  if (keys.length === 0) throw new FinnhubUnavailableError("Finnhub key not configured");

  const attempts = Math.min(2, keys.length);
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    const key = keys[nextKey++ % keys.length];
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // Header auth keeps the key out of URLs (and so out of any logged error).
    const res = await fetch(url, {
      headers: { "X-Finnhub-Token": key },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as T;
    lastStatus = res.status;
    if (res.status !== 429) break;
  }
  throw new FinnhubUnavailableError(`Finnhub ${path} failed (${lastStatus})`);
}

/** US-listed symbols matching `query`: deduped, no dotted/foreign lines. */
export async function searchSymbols(query: string, limit = 8): Promise<SymbolHit[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await finnhubGet<{ result?: RawSearchResult[] }>("/search", { q, exchange: "US" });
  return filterSearchResults(data.result ?? [], limit);
}

export type FinnhubQuote = {
  c: number | null;
  d: number | null;
  dp: number | null;
  h: number | null;
  l: number | null;
  o: number | null;
  pc: number | null;
  t: number | null;
};

type FinnhubProfile = {
  country?: string;
  currency?: string;
  exchange?: string;
  ipo?: string;
  marketCapitalization?: number;
  shareOutstanding?: number;
  name?: string;
  ticker?: string;
  weburl?: string;
  logo?: string;
  finnhubIndustry?: string;
};

/** A validated symbol, shaped for the stocks row plus its first quote. */
export type ValidatedSymbol = {
  ticker: string;
  assetType: "stock" | "etf";
  stock: {
    name: string;
    country: string | null;
    currency: string | null;
    exchange: string | null;
    ipo_date: string | null;
    market_cap: number | null;
    share_outstanding: number | null;
    logo_url: string | null;
    website: string | null;
    industry: string | null;
  };
  quote: FinnhubQuote;
};

export type ValidationResult =
  | { ok: true; value: ValidatedSymbol }
  | { ok: false; reason: string };

/** Finnhub reports market cap and shares outstanding in millions; the ETL
 *  stores whole units in bigint columns. */
function millions(n: number | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1_000_000) : null;
}

/**
 * Confirms `symbol` is a live US listing: /quote must return a real price and
 * /stock/profile2 a US-exchange company. ETFs have no profile2 on the free
 * tier, so a missing profile falls back to an exact /search hit on the US
 * exchange (its type decides stock vs etf); so does an ADR, whose profile is
 * the home listing. 2 calls, 3 for an ETF or ADR.
 */
export async function validateSymbol(rawSymbol: string): Promise<ValidationResult> {
  const ticker = normalizeSymbol(rawSymbol);
  if (!ticker) return { ok: false, reason: "Not A US Ticker" };

  const [quote, profile] = await Promise.all([
    finnhubGet<FinnhubQuote>("/quote", { symbol: ticker }),
    finnhubGet<FinnhubProfile>("/stock/profile2", { symbol: ticker }),
  ]);
  if (!quote || typeof quote.c !== "number" || !(quote.c > 0)) {
    return { ok: false, reason: "No Quote" };
  }

  // An ADR's profile2 describes the home listing (TSM: Taiwan), so a non-US
  // exchange there still needs the US search to confirm the US line exists.
  const profileUs = !!profile?.name && isUsExchange(profile.exchange);
  if (profile?.name && !profileUs) {
    const hits = await searchSymbols(ticker, 20);
    if (!hits.some((h) => h.symbol === ticker)) return { ok: false, reason: "Not A US Listing" };
  }

  if (profile?.name) {
    return {
      ok: true,
      value: {
        ticker,
        assetType: "stock",
        stock: {
          name: profile.name,
          country: profile.country ?? null,
          currency: profileUs ? (profile.currency ?? null) : "USD",
          exchange: profileUs ? normalizeExchange(profile.exchange) : null,
          ipo_date: profile.ipo || null,
          // Home-market currency for an ADR; only trust it on a US listing.
          market_cap: profileUs ? millions(profile.marketCapitalization) : null,
          share_outstanding: millions(profile.shareOutstanding),
          logo_url: profile.logo || null,
          website: profile.weburl || null,
          industry: profile.finnhubIndustry || null,
        },
        quote,
      },
    };
  }

  const hits = await searchSymbols(ticker, 20);
  const exact = hits.find((h) => h.symbol === ticker);
  if (!exact) return { ok: false, reason: "Not A US Listing" };
  return {
    ok: true,
    value: {
      ticker,
      assetType: exact.type === "ETP" ? "etf" : "stock",
      stock: {
        name: exact.description,
        country: "US",
        currency: "USD",
        exchange: null,
        ipo_date: null,
        market_cap: null,
        share_outstanding: null,
        logo_url: null,
        website: null,
        industry: null,
      },
      quote,
    },
  };
}
