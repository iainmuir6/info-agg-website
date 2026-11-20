// Demo mode for the weather cards (public demo video). The six cities the ETL fetches are places Iain has ties to, so a
// demo viewer sees six well-known stand-in cities with made-up readings instead. Pure and deterministic: the same real
// row and day always give the same stand-in, so /misc and the Command Center agree and a re-take looks the same.
// Applied in the reader (lib/misc-content.ts) per request; nothing is cached or written back. Docs: docs/demo-video.md.
import type { WeatherPayload } from "@/lib/misc-content";
import { hash, pick } from "@/lib/demo/seed";

/** Stand-in cities, one per card in order. Keys use the ETL's "City,Region" shape, which the cards label from. */
export const DEMO_CITIES = [
  "London,UK",
  "Tokyo,Japan",
  "Paris,France",
  "Sydney,Australia",
  "Toronto,Canada",
  "Los Angeles,CA",
] as const;

const CONDITIONS = [
  { conditions: "Clear", icon: "clear-day" },
  { conditions: "Partially cloudy", icon: "partly-cloudy-day" },
  { conditions: "Overcast", icon: "cloudy" },
  { conditions: "Rain", icon: "rain" },
  { conditions: "Clear", icon: "clear-day" },
  { conditions: "Partially cloudy", icon: "partly-cloudy-day" },
] as const;

/** A number in [lo, hi] from the hash of seed+salt. */
function between(lo: number, hi: number, seed: string, salt: string): number {
  return lo + (hash(`${salt}:${seed}`) % (hi - lo + 1));
}

/** One made-up reading for a stand-in city. `seed` is the stand-in plus the real row's fetch day. */
function fakePayload(seed: string, real: WeatherPayload): WeatherPayload {
  const base = between(38, 78, seed, "base");
  const now = pick(CONDITIONS, seed, "now");
  return {
    resolved_address: null,
    timezone: null,
    current: {
      temp: base,
      feelslike: base + between(-4, 2, seed, "feels"),
      humidity: between(35, 85, seed, "hum"),
      windspeed: between(2, 16, seed, "wind"),
      conditions: now.conditions,
      icon: now.icon,
      sunrise: null,
      sunset: null,
    },
    // Real dates (so the weekday strip is right), made-up values.
    forecast: real.forecast.map((d) => {
      const day = `${seed}|${d.date}`;
      const hi = base + between(-6, 8, day, "hi");
      const c = pick(CONDITIONS, day, "sky");
      return {
        date: d.date,
        tempmax: hi,
        tempmin: hi - between(8, 16, day, "lo"),
        conditions: c.conditions,
        icon: c.icon,
        precipprob: c.icon === "rain" ? between(50, 90, day, "pop") : between(0, 20, day, "pop"),
      };
    }),
  };
}

/** Swap every real city for a stand-in, keeping the number and order of cards and the fetch times. */
export function demoWeather<T extends { key: string; payload: WeatherPayload; fetched_at: string }>(rows: T[]): T[] {
  return rows.map((r, i) => {
    const key = DEMO_CITIES[i % DEMO_CITIES.length];
    return { ...r, key, payload: fakePayload(`${key}|${r.fetched_at.slice(0, 10)}`, r.payload) };
  });
}
