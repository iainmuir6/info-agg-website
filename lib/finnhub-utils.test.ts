import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterSearchResults,
  isUsExchange,
  normalizeExchange,
  normalizeSymbol,
} from "@/lib/finnhub-utils";
import { TRACKED_STOCKS_CAP } from "@/lib/tracked-stocks-shared";

test("normalizeSymbol keeps plain US symbols only", () => {
  assert.equal(normalizeSymbol(" ant "), "ANT");
  assert.equal(normalizeSymbol("brk-b"), "BRK-B");
  assert.equal(normalizeSymbol("ANT.VI"), null);
  assert.equal(normalizeSymbol("BRK.B"), null);
  assert.equal(normalizeSymbol("BINANCE:BTCUSDT"), null);
  assert.equal(normalizeSymbol(""), null);
  assert.equal(normalizeSymbol("TOOLONGX"), null);
  assert.equal(normalizeSymbol("1ABC"), null);
});

test("filterSearchResults dedupes, drops foreign lines and odd types", () => {
  const hits = filterSearchResults([
    { symbol: "ANT", description: "ANTHROPIC PBC-CL A", type: "Common Stock" },
    { symbol: "ANT", description: "Anthropic, PBC", type: "Common Stock" },
    { symbol: "ANT.VI", description: "ANTHROPIC PBC", type: "Common Stock" },
    { symbol: "ANT.CN", description: "ANTEROS METALS", type: "Common Stock" },
    { symbol: "ANTWS", description: "ANT WARRANT", type: "Warrant" },
    { symbol: "SPY", description: "SPDR S&P 500", type: "ETP" },
    { symbol: "TSM", description: "TAIWAN SEMI ADR", type: "ADR" },
  ]);
  assert.deepEqual(
    hits.map((h) => h.symbol),
    ["ANT", "SPY", "TSM"],
  );
  assert.equal(hits[0].description, "ANTHROPIC PBC-CL A");
});

test("filterSearchResults respects the limit", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    symbol: `A${String.fromCharCode(65 + i)}`,
    description: "x",
    type: "Common Stock",
  }));
  assert.equal(filterSearchResults(many, 8).length, 8);
});

test("exchange names normalise to the short form stocks rows hold", () => {
  assert.equal(normalizeExchange("NASDAQ NMS - GLOBAL MARKET"), "NASDAQ");
  assert.equal(normalizeExchange("NEW YORK STOCK EXCHANGE, INC."), "NYSE");
  assert.equal(normalizeExchange("NYSE ARCA"), "NYSE ARCA");
  assert.equal(normalizeExchange(null), null);
  assert.equal(isUsExchange("NASDAQ NMS - GLOBAL MARKET"), true);
  assert.equal(isUsExchange("WIENER BOERSE AG"), false);
  assert.equal(isUsExchange(undefined), false);
});

test("the cap matches the SQL trigger and the Python constant", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile("supabase/15_tracked_stocks.sql", "utf8");
  const py = await readFile("src/api/run_etl.py", "utf8");
  assert.match(sql, new RegExp(`cap CONSTANT integer := ${TRACKED_STOCKS_CAP};`));
  assert.match(py, new RegExp(`^TRACKED_STOCKS_CAP = ${TRACKED_STOCKS_CAP}$`, "m"));
});
