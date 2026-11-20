/**
 * Pure helpers behind lib/finnhub.ts (no network, no server-only import), so
 * they can be unit-tested and shared with the client-safe search response.
 */

export type RawSearchResult = {
  symbol?: string;
  displaySymbol?: string;
  description?: string;
  type?: string;
};

export type SymbolHit = {
  symbol: string;
  description: string;
  type: string;
};

/** Listing types a user may track. Funds, warrants, units, rights and
 *  preferred lines are left out: they rarely have a usable quote or profile. */
const TRACKABLE_TYPES = new Set(["Common Stock", "ADR", "ETP", "REIT"]);

/** Plain US symbols only: letters/digits, optionally a hyphenated class
 *  letter. Anything with a dot or colon is left out: foreign or
 *  exchange-prefixed lines (ANT.VI, BINANCE:BTCUSDT), and also Finnhub's
 *  dotted share classes (BRK.B), which the ETL has never quoted. */
const US_SYMBOL = /^[A-Z][A-Z0-9]{0,5}(-[A-Z])?$/;

export function isUsSymbol(symbol: string): boolean {
  return US_SYMBOL.test(symbol);
}

/** Uppercases and trims; null when the result isn't a plain US symbol. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return isUsSymbol(s) ? s : null;
}

/** Dedupes by symbol (search repeats listings), drops non-US and
 *  non-trackable lines, keeps Finnhub's relevance order. */
export function filterSearchResults(results: RawSearchResult[], limit = 8): SymbolHit[] {
  const seen = new Set<string>();
  const out: SymbolHit[] = [];
  for (const r of results) {
    const symbol = (r.symbol ?? "").trim().toUpperCase();
    if (!symbol || seen.has(symbol) || !isUsSymbol(symbol)) continue;
    if (!TRACKABLE_TYPES.has(r.type ?? "")) continue;
    seen.add(symbol);
    out.push({ symbol, description: (r.description ?? "").trim() || symbol, type: r.type ?? "" });
    if (out.length >= limit) break;
  }
  return out;
}

const US_EXCHANGES: [RegExp, string][] = [
  [/NASDAQ/i, "NASDAQ"],
  [/NEW YORK STOCK EXCHANGE|^NYSE(?! ARCA| AMERICAN)/i, "NYSE"],
  [/NYSE ARCA/i, "NYSE ARCA"],
  [/NYSE AMERICAN|NYSE MKT|AMEX/i, "NYSE AMERICAN"],
  [/CBOE|BATS/i, "CBOE"],
];

/** Finnhub profile2 exchange names ("NASDAQ NMS - GLOBAL MARKET",
 *  "NEW YORK STOCK EXCHANGE, INC.") to the short form stocks rows hold. */
export function normalizeExchange(exchange: string | null | undefined): string | null {
  if (!exchange) return null;
  for (const [re, short] of US_EXCHANGES) if (re.test(exchange)) return short;
  return exchange;
}

export function isUsExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return US_EXCHANGES.some(([re]) => re.test(exchange));
}
