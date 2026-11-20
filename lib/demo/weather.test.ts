import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CITIES, demoWeather } from "@/lib/demo/weather";
import type { WeatherPayload } from "@/lib/misc-content";

const REAL_CITIES = ["New York", "Charlottesville", "Chicago", "Brora", "Scotland", "Aspen", "Bangkok", "Thailand", "Virginia"];

function payload(n: number): WeatherPayload {
  return {
    resolved_address: `Real Place ${n}, Charlottesville, VA`,
    timezone: "America/New_York",
    current: { temp: 91.3 + n, feelslike: 97.1, humidity: 61.2, windspeed: 7.7, conditions: "Rain, Overcast", icon: "rain", sunrise: "06:41:00", sunset: "19:52:00" },
    forecast: ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"].map((date) => ({ date, tempmax: 93.4, tempmin: 71.9, conditions: "Rain", icon: "rain", precipprob: 87.3 })),
  };
}
const KEYS = ["New York,NY", "Charlottesville,VA", "Chicago,IL", "Brora,Scotland", "Aspen,CO", "Bangkok,Thailand"];
const rows = KEYS.map((key, i) => ({ key, payload: payload(i), fetched_at: "2026-11-20T11:22:00Z" }));

test("no real city, address, timezone or reading survives", () => {
  const out = demoWeather(rows);
  const json = JSON.stringify(out);
  for (const real of REAL_CITIES) assert.ok(!json.includes(real), `leaked ${real}`);
  assert.ok(!json.includes("America/New_York"));
  assert.ok(!json.includes("06:41:00"));
  for (const r of out) {
    assert.ok(!rows.some((x) => x.payload.current.temp === r.payload.current.temp), "real temp survived");
    for (const d of r.payload.forecast) assert.notEqual(d.tempmax, 93.4);
  }
});

test("keeps the number and order of cards, the dates and the fetch time", () => {
  const out = demoWeather(rows);
  assert.deepEqual(out.map((r) => r.key), [...DEMO_CITIES]);
  assert.deepEqual(out[0].payload.forecast.map((d) => d.date), rows[0].payload.forecast.map((d) => d.date));
  assert.equal(out[3].fetched_at, rows[3].fetched_at);
});

test("is deterministic and readings are sensible", () => {
  assert.deepEqual(demoWeather(rows), demoWeather(rows));
  for (const r of demoWeather(rows)) {
    for (const d of r.payload.forecast) assert.ok((d.tempmax ?? 0) > (d.tempmin ?? 0));
  }
});
