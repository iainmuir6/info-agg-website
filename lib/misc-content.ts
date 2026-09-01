import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Typed access to `info_agg.misc_content`.
 *
 *  The table stores every misc card as an untyped JSONB payload keyed by
 *  (kind, key) — see supabase/10_misc_content.sql for why one table beats six.
 *  Postgres cannot enforce the payload shape, so this module is the single
 *  place that does: one narrowing function per kind, and nothing else in the
 *  app touches `payload` directly. */

export type WeatherPayload = {
  resolved_address: string | null;
  timezone: string | null;
  current: {
    temp: number | null;
    feelslike: number | null;
    humidity: number | null;
    windspeed: number | null;
    conditions: string | null;
    icon: string | null;
    sunrise: string | null;
    sunset: string | null;
  };
  forecast: {
    date: string;
    tempmax: number | null;
    tempmin: number | null;
    conditions: string | null;
    icon: string | null;
    precipprob: number | null;
  }[];
};

export type Holiday = {
  name: string;
  date: string;
  description?: string | null;
  type?: string | null;
};

export type WikipediaPayload = {
  title: string;
  description?: string | null;
  extract?: string | null;
  url?: string | null;
  thumbnail?: string | null;
};

export type OnThisDayEvent = {
  year: number | null;
  text: string;
  url?: string | null;
};

export type CountryPayload = {
  cca2: string | null;
  name_common: string | null;
  name_official: string | null;
  region: string | null;
  subregion: string | null;
  capital: string | null;
  population: number | null;
  area_km2: number | null;
  currencies: { code: string | null; name: string | null; symbol: string | null }[];
  languages: string[];
  timezones: string[];
  continents: string[];
  borders: string[];
  flag_emoji: string | null;
  flag_png: string | null;
  map_url: string | null;
  population_rank?: number | null;
  area_rank?: number | null;
  ranked_of?: number | null;
};

export type WordPayload = {
  title: string;
  link?: string | null;
  pub_date?: string | null;
  description?: string | null;
};

export type FactPayload = {
  text: string;
  source?: string | null;
  source_url?: string | null;
  permalink?: string | null;
};

export type MiscRow = {
  kind: string;
  key: string;
  payload: unknown;
  fetched_at: string;
};

export type MiscContent = {
  weather: { key: string; payload: WeatherPayload; fetched_at: string }[];
  holidays: Holiday[];
  wikipedia: WikipediaPayload[];
  onThisDay: OnThisDayEvent[];
  country: CountryPayload | null;
  word: WordPayload | null;
  facts: FactPayload[];
  fetchedAt: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** A payload with no usable title/text is treated as absent rather than
 *  rendered as an empty card — an upstream can return 200 with nothing. */
function asWeather(p: unknown): WeatherPayload | null {
  if (!isRecord(p) || !isRecord(p.current)) return null;
  return p as unknown as WeatherPayload;
}
function asWikipedia(p: unknown): WikipediaPayload | null {
  return isRecord(p) && typeof p.title === "string" ? (p as unknown as WikipediaPayload) : null;
}
function asCountry(p: unknown): CountryPayload | null {
  return isRecord(p) && typeof p.name_common === "string"
    ? (p as unknown as CountryPayload)
    : null;
}
function asWord(p: unknown): WordPayload | null {
  return isRecord(p) && typeof p.title === "string" && p.title.length > 0
    ? (p as unknown as WordPayload)
    : null;
}
function asFact(p: unknown): FactPayload | null {
  return isRecord(p) && typeof p.text === "string" && p.text.length > 0
    ? (p as unknown as FactPayload)
    : null;
}
function asOnThisDay(p: unknown): OnThisDayEvent[] {
  if (!isRecord(p) || !Array.isArray(p.events)) return [];
  return (p.events as unknown[]).filter(
    (e): e is OnThisDayEvent => isRecord(e) && typeof e.text === "string"
  );
}
function asHolidays(p: unknown): Holiday[] {
  if (!isRecord(p) || !Array.isArray(p.holidays)) return [];
  return (p.holidays as unknown[]).filter(
    (h): h is Holiday => isRecord(h) && typeof h.name === "string" && typeof h.date === "string"
  );
}

/** Order weather cards the way the ETL lists the cities, not by insertion. */
export const WEATHER_ORDER = [
  "New York,NY",
  "Charlottesville,VA",
  "Chicago,IL",
  "Brora,Scotland",
  "Aspen,CO",
  "Bangkok,Thailand",
] as const;

/** The ('country','ranks') row is an ETL-side rank cache, not a card. */
const RANKS_KEY = "ranks";

export async function getMiscContent(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<MiscContent> {
  const client = supabase ?? (await createClient());
  const { data } = await client
    .from("misc_content")
    .select("kind, key, payload, fetched_at");

  const rows = (data ?? []) as MiscRow[];
  const byKind = (kind: string) =>
    rows
      .filter((r) => r.kind === kind && r.key !== RANKS_KEY)
      // Multi-row kinds are keyed '0','1',... — keep that order, not the
      // database's.
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const one = (kind: string) => byKind(kind)[0]?.payload;

  const weather = byKind("weather")
    .map((r) => {
      const payload = asWeather(r.payload);
      return payload ? { key: r.key, payload, fetched_at: r.fetched_at } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => {
      const ia = WEATHER_ORDER.indexOf(a.key as (typeof WEATHER_ORDER)[number]);
      const ib = WEATHER_ORDER.indexOf(b.key as (typeof WEATHER_ORDER)[number]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  const fetchedAt =
    rows.length > 0
      ? rows.map((r) => r.fetched_at).sort().slice(-1)[0]
      : null;

  return {
    weather,
    holidays: asHolidays(one("holiday")),
    wikipedia: byKind("wikipedia")
      .map((r) => asWikipedia(r.payload))
      .filter((p): p is WikipediaPayload => p !== null),
    onThisDay: asOnThisDay(one("onthisday")),
    country: asCountry(one("country")),
    word: asWord(one("word")),
    facts: byKind("fact")
      .map((r) => asFact(r.payload))
      .filter((p): p is FactPayload => p !== null),
    fetchedAt,
  };
}
