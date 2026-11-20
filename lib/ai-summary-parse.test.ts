import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asDay,
  asSources,
  asWeek,
  isInternalSourceUrl,
  isSafeSourceUrl,
} from "@/lib/ai-summary-parse";

// Shapes as stored before citations existed (no sources, no cites, string bullets).
const LEGACY_DAY = {
  kind: "day",
  headline: "Broadcom slides 11%",
  yesterday: [{ domain: "markets", title: "Chips fall", detail: "AVGO fell 11.5%." }],
  today: [{ domain: "sports", title: "SMU at Notre Dame", detail: "Kickoff on NBC." }],
  model: "gemini-flash-lite-latest",
  generated_at: "2026-11-20T04:26:40-05:00",
  grounded_on: { NEWS: 45 },
};

const LEGACY_WEEK = {
  kind: "week",
  headline: "A week of chips",
  sections: [{ domain: "markets", bullets: ["AVGO fell 11.5%.", "  "] }],
  model: "gemini-flash-lite-latest",
  generated_at: "2026-11-16T04:38:55-05:00",
};

const source = (n: number, url = `https://example.com/${n}`) => ({
  n,
  title: `Story ${n}`,
  url,
  kind: "article",
  outlet: "NYT",
});

test("legacy day payload parses with empty cites and sources", () => {
  const day = asDay(LEGACY_DAY);
  assert.ok(day);
  assert.deepEqual(day.sources, []);
  assert.deepEqual(day.yesterday[0].cites, []);
  assert.deepEqual(day.today[0].cites, []);
  assert.equal(day.headline, "Broadcom slides 11%");
});

test("legacy string bullets become { text, cites: [] } and blanks drop", () => {
  const week = asWeek(LEGACY_WEEK);
  assert.ok(week);
  assert.deepEqual(week.sections[0].bullets, [{ text: "AVGO fell 11.5%.", cites: [] }]);
  assert.deepEqual(week.sources, []);
});

test("cites without a matching source are dropped", () => {
  const day = asDay({
    ...LEGACY_DAY,
    yesterday: [{ ...LEGACY_DAY.yesterday[0], cites: [1, 7, 1, "2", 2] }],
    sources: [source(1), source(2)],
  });
  assert.ok(day);
  assert.deepEqual(day.yesterday[0].cites, [1, 2]);
  assert.deepEqual(day.today[0].cites, []);
  assert.deepEqual(day.sources.map((s) => s.n), [1, 2]);
});

test("sources with unsafe URLs are refused, and so are cites to them", () => {
  const week = asWeek({
    ...LEGACY_WEEK,
    sections: [{ domain: "markets", bullets: [{ text: "AVGO fell.", cites: [1, 2, 3] }] }],
    sources: [
      source(1, "javascript:alert(1)"),
      source(2, "//evil.example/x"),
      { ...source(3, "/markets/AVGO"), kind: "quote", outlet: "Markets" },
    ],
  });
  assert.ok(week);
  assert.deepEqual(week.sections[0].bullets[0].cites, [3]);
  assert.deepEqual(week.sources.map((s) => s.url), ["/markets/AVGO"]);
  assert.equal(week.sources[0].kind, "quote");
});

test("uncited sources are left out of the list", () => {
  const day = asDay({
    ...LEGACY_DAY,
    yesterday: [{ ...LEGACY_DAY.yesterday[0], cites: [2] }],
    sources: [source(1), source(2)],
  });
  assert.ok(day);
  assert.deepEqual(day.sources.map((s) => s.n), [2]);
});

test("asSources validates, dedupes and sorts", () => {
  const out = asSources([
    source(3),
    source(1),
    source(1, "https://dup.example"),
    { n: 0, title: "zero", url: "https://x" },
    { n: 2.5, title: "half", url: "https://x" },
    { n: 4, title: "", url: "https://x" },
    { n: 5, title: "odd kind", url: "https://x", kind: "podcast" },
    "nope",
  ]);
  assert.deepEqual(out.map((s) => s.n), [1, 3, 5]);
  assert.equal(out[0].url, "https://example.com/1");
  assert.equal(out[2].kind, "article");
  assert.equal(out[2].outlet, null);
  assert.deepEqual(asSources(undefined), []);
});

test("url guards", () => {
  assert.ok(isSafeSourceUrl("https://www.espn.com/nba/game/_/gameId/1"));
  assert.ok(isSafeSourceUrl("http://example.com"));
  assert.ok(isSafeSourceUrl("/markets/NVDA"));
  assert.ok(!isSafeSourceUrl("//evil.example"));
  assert.ok(!isSafeSourceUrl("/\\evil.example"));
  assert.ok(!isSafeSourceUrl("javascript:alert(1)"));
  assert.ok(!isSafeSourceUrl("data:text/html,x"));
  assert.ok(!isSafeSourceUrl("not a url"));
  assert.ok(isInternalSourceUrl("/markets/NVDA"));
  assert.ok(!isInternalSourceUrl("https://example.com"));
});

test("unknown domains and non-records still drop", () => {
  assert.equal(asDay(null), null);
  assert.equal(asWeek("x"), null);
  assert.equal(
    asDay({ yesterday: [{ domain: "toString", title: "t", detail: "d" }], today: [] }),
    null
  );
});
