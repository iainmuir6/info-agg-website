import { ThumbImage } from "@/components/thumb-image";
import { CountryMap } from "@/components/country-map";
import type {
  CountryPayload,
  FactPayload,
  Holiday,
  OnThisDayEvent,
  WeatherPayload,
  WikipediaPayload,
  WordPayload,
} from "@/lib/misc-content";

export const MISC_ACCENT = "hsl(265 70% 55%)";

/** Visual Crossing icon slug → a glyph, so the card needs no image fetch. */
const WEATHER_GLYPH: Record<string, string> = {
  "clear-day": "☀",
  "clear-night": "☾",
  "partly-cloudy-day": "⛅",
  "partly-cloudy-night": "☁",
  cloudy: "☁",
  wind: "≋",
  fog: "≡",
  rain: "☂",
  "showers-day": "☂",
  "showers-night": "☂",
  snow: "❄",
  "snow-showers-day": "❄",
  "snow-showers-night": "❄",
  thunder: "⚡",
  "thunder-rain": "⚡",
  "thunder-showers-day": "⚡",
  "thunder-showers-night": "⚡",
};

/** Today's high/low, reconciled against the current reading.
 *
 *  Visual Crossing returns `currentConditions` live but `days[0]` from the
 *  forecast issued for that day, and the two can disagree: on 2026-09-01
 *  Charlottesville came back as 98.6° current against a 92.5° daily high, and
 *  New York as 80.9° against 80.8°. Showing a high beneath the temperature
 *  printed next to it reads as a bug in this card, so the observed value wins.
 *  This only ever widens the range — it never invents a number. */
function todayRange(
  current: number | null,
  high: number | null,
  low: number | null,
): { high: number | null; low: number | null } {
  if (current == null) return { high, low };
  return {
    high: high == null ? high : Math.max(high, current),
    low: low == null ? low : Math.min(low, current),
  };
}

const glyph = (icon: string | null | undefined) =>
  (icon && WEATHER_GLYPH[icon]) || "○";

/** Display name for a weather row.
 *
 *  Derived from the ETL key ("Bangkok,Thailand"), NOT from Visual Crossing's
 *  `resolvedAddress` — that comes back in the location's own language, which
 *  rendered Bangkok as กรุงเทพมหานคร. The key is always the English string we
 *  asked for.
 */
function cityLabel(key: string, parts = 1): string {
  return key
    .split(",")
    .slice(0, parts)
    .map((p) => p.trim())
    .join(", ");
}

/** Row label chip, matching the HubCap pills on the homepage news rows. */
function Pill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center min-w-[5ch] px-1 py-0.5 rounded text-[7px] font-mono uppercase leading-none tracking-wide"
      style={{
        background: "color-mix(in srgb, " + MISC_ACCENT + " 15%, transparent)",
        color: MISC_ACCENT,
      }}
    >
      {label}
    </span>
  );
}

function CardShell({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string | null;
  children: React.ReactNode;
  /** Grid-span overrides for cards that need more than one cell on /misc. */
  className?: string;
}) {
  return (
    <section className={`bg-background p-3 flex flex-col${className ? ` ${className}` : ""}`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase">
          <span style={{ color: MISC_ACCENT }}>▪</span> {title}
        </h3>
        {meta && (
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            {meta}
          </span>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

export function WeatherCard({
  city,
  data,
}: {
  city: string;
  data: WeatherPayload;
}) {
  const c = data.current;
  const round = (n: number | null) => (n == null ? "—" : Math.round(n));
  const label = cityLabel(city, 2);

  return (
    <CardShell title={label} meta={c.conditions}>
      <div className="flex items-start gap-3">
        <span className="text-4xl leading-none" aria-hidden>
          {glyph(c.icon)}
        </span>
        <div>
          <p className="text-3xl font-black leading-none tabular-nums">
            {round(c.temp)}°
          </p>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            FEELS {round(c.feelslike)}° · HUM {round(c.humidity)}% · WIND{" "}
            {round(c.windspeed)}
          </p>
        </div>
      </div>

      {data.forecast.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border grid grid-cols-5 gap-1">
          {data.forecast.slice(0, 5).map((d, di) => (
            <div key={d.date} className="text-center">
              <p className="text-[9px] font-mono text-muted-foreground uppercase">
                {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                })}
              </p>
              <p className="text-sm leading-tight" aria-hidden>
                {glyph(d.icon)}
              </p>
              <p className="text-[10px] font-mono tabular-nums">
                {/* Only day 0 is reconciled — it is the one the current
                    reading can contradict. */}
                {round(di === 0 ? todayRange(c.temp, d.tempmax, d.tempmin).high : d.tempmax)}°
                <span className="text-muted-foreground">
                  /{round(di === 0 ? todayRange(c.temp, d.tempmax, d.tempmin).low : d.tempmin)}°
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

/** Tear-off calendar tile: month cap over the day number.
 *
 *  Shared by the /misc Upcoming Holidays list and the Command Center's
 *  CalendarMini so the two cannot drift apart. */
function CalendarTile({ date }: { date: string }) {
  const d = new Date(`${date}T12:00:00`);
  return (
    <div className="shrink-0 w-7 border border-border rounded-sm overflow-hidden bg-background">
      <div
        className="text-[7px] font-mono font-bold text-center leading-[9px] text-white uppercase"
        style={{ background: MISC_ACCENT }}
      >
        {d.toLocaleDateString("en-US", { month: "short" })}
      </div>
      <div className="text-[11px] font-black text-center leading-[13px] tabular-nums">
        {d.getDate()}
      </div>
    </div>
  );
}

export function HolidaysCard({ holidays }: { holidays: Holiday[] }) {
  return (
    <CardShell title="Upcoming Holidays" meta={`${holidays.length}`}>
      {/* Two columns once there is room: eight holidays as one long list left
          most of the cell empty beside the taller cards next to it. */}
      <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-4 gap-y-1.5">
        {holidays.slice(0, 8).map((h) => (
          <li key={`${h.date}-${h.name}`} className="flex gap-2 items-center">
            <CalendarTile date={h.date} />
            <span className="text-xs leading-snug min-w-0">{h.name}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function WikipediaCard({ pages }: { pages: WikipediaPayload[] }) {
  return (
    <CardShell title="From Wikipedia" meta={`${pages.length} RANDOM`}>
      <div className="space-y-2">
        {pages.map((page, i) => (
          <a
            key={page.title}
            href={page.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`group block ${i > 0 ? "pt-2 border-t border-border" : ""}`}
          >
            <div className="flex gap-2.5">
              <ThumbImage
                src={page.thumbnail}
                className="w-12 h-12 object-cover border border-border shrink-0"
              />
              <div className="min-w-0">
                <p
                  className="text-sm font-bold leading-tight group-hover:underline"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  {page.title}
                </p>
                {page.description && (
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mt-0.5 line-clamp-1">
                    {page.description}
                  </p>
                )}
              </div>
            </div>
            {page.extract && (
              <p className="text-xs leading-relaxed text-muted-foreground mt-1.5 line-clamp-3">
                {page.extract}
              </p>
            )}
          </a>
        ))}
      </div>
    </CardShell>
  );
}

export function OnThisDayCard({ events }: { events: OnThisDayEvent[] }) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  return (
    <CardShell title="On This Day" meta={today}>
      <ul className="space-y-1">
        {events.map((e, i) => {
          const body = (
            <>
              <span
                className="text-[10px] font-mono font-bold tabular-nums shrink-0 w-9"
                style={{ color: MISC_ACCENT }}
              >
                {e.year}
              </span>
              <span className="text-xs leading-snug min-w-0">{e.text}</span>
            </>
          );
          return (
            <li key={`${e.year}-${i}`}>
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2 items-baseline group hover:underline"
                >
                  {body}
                </a>
              ) : (
                <div className="flex gap-2 items-baseline">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

/** Rank badge, colored by percentile: better rank = greener.
 *
 *  The scale is relative to the field size, not the raw number — #20 means
 *  something very different out of 254 than out of 30. Buckets rather than a
 *  gradient so the colors stay distinguishable at 9px, and both hues come from
 *  the palette the rest of the site already uses for up/down.
 */
const RANK_SCALE = [
  { max: 0.1, color: "hsl(142 70% 38%)" },  // top 10%
  { max: 0.33, color: "hsl(142 55% 45%)" }, // top third
  { max: 0.66, color: "hsl(220 6% 50%)" },  // middle — deliberately neutral
  { max: 0.9, color: "hsl(15 75% 52%)" },   // bottom third
  { max: Infinity, color: "hsl(0 72% 50%)" }, // bottom 10%
];

function rankColor(rank: number, of?: number | null): string {
  // With no field size we cannot say whether the rank is good, so stay neutral.
  if (!of || of <= 1) return "hsl(220 6% 50%)";
  const pct = (rank - 1) / (of - 1);
  return (RANK_SCALE.find((b) => pct <= b.max) ?? RANK_SCALE[2]).color;
}

/** "#11 of 254" — the rank is meaningless without the field size. */
function Rank({ rank, of }: { rank?: number | null; of?: number | null }) {
  if (!rank) return null;
  const color = rankColor(rank, of);
  return (
    <span
      className="ml-1.5 text-[9px] font-mono font-bold px-1 py-px rounded-sm align-middle whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
      title={of ? `Ranked ${rank} of ${of} countries` : undefined}
    >
      #{rank}
      {of ? <span className="opacity-55">/{of}</span> : null}
    </span>
  );
}

export function CountryCard({ country }: { country: CountryPayload }) {
  const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString());
  const rows: [string, React.ReactNode][] = [
    ["CAPITAL", country.capital ?? "—"],
    ["REGION", [country.region, country.subregion].filter(Boolean).join(" · ") || "—"],
    [
      "POPULATION",
      <>
        {fmt(country.population)}
        <Rank rank={country.population_rank} of={country.ranked_of} />
      </>,
    ],
    [
      "AREA",
      <>
        {country.area_km2 ? `${fmt(country.area_km2)} km²` : "—"}
        <Rank rank={country.area_rank} of={country.ranked_of} />
      </>,
    ],
    ["LANGUAGES", country.languages.slice(0, 3).join(", ") || "—"],
    [
      "CURRENCY",
      country.currencies
        .map((c) => [c.code, c.symbol && `(${c.symbol})`].filter(Boolean).join(" "))
        .join(", ") || "—",
    ],
    ["TIMEZONES", country.timezones.length ? `${country.timezones.length}` : "—"],
    ["BORDERS", country.borders.length ? country.borders.join(", ") : "None (island)"],
  ];

  return (
    // Two grid cells wide on /misc: a flag, a map and eight labelled facts do
    // not fit one cell without the map shrinking to a stamp and every fact
    // wrapping onto a second line.
    <CardShell title="Country of the Day" meta={country.cca2} className="sm:col-span-2">
      <div className="grid gap-4 sm:grid-cols-2 items-start">
      <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl leading-none" aria-hidden>
          {country.flag_emoji}
        </span>
        <div>
          <p
            className="text-base font-bold leading-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            {country.name_common}
          </p>
          {country.name_official &&
            country.name_official !== country.name_common && (
              <p className="text-[10px] font-mono text-muted-foreground leading-tight">
                {country.name_official}
              </p>
            )}
        </div>
      </div>
      {country.lat != null && country.lng != null && (
        <CountryMap
          lat={country.lat}
          lng={country.lng}
          name={country.name_common}
          ccn3={country.ccn3}
          areaKm2={country.area_km2}
          className="h-[170px] border border-border mb-3"
        />
      )}
      </div>
      {/* Facts run in their own column beside the map, and split again into
          two on a wide screen. BORDERS is the one row that can list a dozen
          neighbours, so it spans the full width rather than forcing the
          column to the width of its longest value. */}
      <dl className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-x-4 gap-y-1 content-start">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className={`flex gap-2 items-baseline${
              k === "BORDERS" ? " min-[560px]:col-span-2" : ""
            }`}
          >
            <dt className="text-[9px] font-mono text-muted-foreground w-20 shrink-0">
              {k}
            </dt>
            <dd className="text-xs leading-snug min-w-0">{v}</dd>
          </div>
        ))}
      </dl>
      </div>
    </CardShell>
  );
}

export function WordCard({ word }: { word: WordPayload }) {
  return (
    <CardShell title="Word of the Day" meta="MERRIAM-WEBSTER">
      <a
        href={word.link ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="group block"
      >
        <p
          className="text-base font-black leading-tight group-hover:underline"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {word.title}
        </p>
        <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
          {word.pronunciation && <span>\{word.pronunciation}\</span>}
          {word.part_of_speech && (
            <span className="italic ml-1.5">{word.part_of_speech}</span>
          )}
        </p>
      </a>

      {word.definition && (
        <p className="text-xs leading-relaxed mt-2">{word.definition}</p>
      )}
      {word.example && (
        <p
          className="text-xs leading-relaxed text-muted-foreground italic mt-2 pl-2 border-l-2"
          style={{ borderColor: MISC_ACCENT }}
        >
          {word.example}
        </p>
      )}
      {/* Nothing parsed out of the feed — show it whole rather than blank. */}
      {!word.definition && word.description && (
        <p className="text-xs leading-relaxed text-muted-foreground mt-2 line-clamp-5">
          {word.description}
        </p>
      )}
    </CardShell>
  );
}

export function FactCard({ facts }: { facts: FactPayload[] }) {
  return (
    <CardShell title="Useless Facts" meta="DID YOU KNOW">
      <ul className="space-y-1.5">
        {facts.map((fact, i) => (
          <li
            key={fact.text}
            className={`flex gap-2 ${i > 0 ? "pt-1.5 border-t border-border" : ""}`}
          >
            <span
              className="text-xs font-mono shrink-0 leading-relaxed"
              style={{ color: MISC_ACCENT }}
              aria-hidden
            >
              ›
            </span>
            <p
              className="text-sm leading-relaxed"
              style={{ fontFamily: "Georgia, serif" }}
            >
              {fact.text}
            </p>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Command Center variants
//
// The homepage renders these inside a narrow masonry column (~250px), so they
// are not the /misc cards scaled down — they drop the forecast strip and the
// prose and keep only what survives at that width. The glyph map and the
// weather semantics are shared with the full cards above.
// ───────────────────────────────────────────────────────────────────────────

/** 2 rows x 3 columns of cities, matching the /misc glyphs and formatting. */
export function WeatherGridMini({
  cities,
}: {
  cities: { key: string; payload: WeatherPayload }[];
}) {
  const round = (n: number | null) => (n == null ? "—" : Math.round(n));

  return (
    <div className="grid grid-cols-3">
      {cities.slice(0, 6).map((c, i) => {
        const cur = c.payload.current;
        const today = c.payload.forecast[0];
        return (
          <div
            key={c.key}
            className={`flex flex-col items-center text-center px-1 py-1 border-border
              ${i % 3 !== 2 ? "border-r" : ""} ${i < 3 ? "border-b" : ""}`}
            title={cur.conditions ?? undefined}
          >
            <span className="text-[8px] font-mono text-muted-foreground uppercase truncate w-full leading-[11px]">
              {cityLabel(c.key)}
            </span>
            <span className="flex items-center gap-1 leading-none">
              <span className="text-sm" aria-hidden>{glyph(cur.icon)}</span>
              <span className="text-sm font-black tabular-nums">{round(cur.temp)}°</span>
            </span>
            {today && (
              <span className="text-[8px] font-mono text-muted-foreground tabular-nums leading-[11px]">
                {round(todayRange(cur.temp, today.tempmax, today.tempmin).high)}/
                {round(todayRange(cur.temp, today.tempmax, today.tempmin).low)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Apple/Google-style day tiles: a colored month cap over a large day number. */
export function CalendarMini({ holidays }: { holidays: Holiday[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div>
      {holidays.slice(0, 5).map((h) => {
        const d = new Date(`${h.date}T12:00:00`);
        const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
        const away =
          days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

        return (
          <div
            key={`${h.date}-${h.name}`}
            className="flex items-center gap-2 px-2 py-0.5 min-h-[30px] border-b border-border last:border-0"
          >
            <CalendarTile date={h.date} />
            <p className="min-w-0 flex-1 text-[10px] font-semibold leading-tight line-clamp-2">
              {h.name}
            </p>
            <span className="text-[8px] font-mono text-muted-foreground shrink-0 text-right leading-tight">
              {away}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Country facts + ranks, as a two-column grid in the narrow homepage column.
 *
 *  Values are abbreviated (122.7M, not 122,680,000) because a full-precision
 *  population plus a rank badge does not fit half of a ~250px column.
 */
export function CountryMini({ country }: { country: CountryPayload }) {
  const compact = (n: number | null) => {
    if (n == null) return "—";
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  };

  const cells: [string, React.ReactNode][] = [
    ["Capital", country.capital ?? "—"],
    ["Region", country.subregion || country.region || "—"],
    [
      "Population",
      <>
        {compact(country.population)}
        <Rank rank={country.population_rank} of={country.ranked_of} />
      </>,
    ],
    [
      "Area",
      <>
        {country.area_km2 ? `${compact(country.area_km2)} km²` : "—"}
        <Rank rank={country.area_rank} of={country.ranked_of} />
      </>,
    ],
    ["Languages", country.languages.slice(0, 2).join(", ") || "—"],
    ["Currency", country.currencies.map((c) => c.code).join(", ") || "—"],
  ];

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border">
        <span className="text-base leading-none" aria-hidden>
          {country.flag_emoji}
        </span>
        <p
          className="text-[11px] font-bold leading-tight min-w-0"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {country.name_common}
        </p>
      </div>
      {country.lat != null && country.lng != null && (
        <CountryMap
          lat={country.lat}
          lng={country.lng}
          name={country.name_common}
          ccn3={country.ccn3}
          areaKm2={country.area_km2}
          className="h-[115px] border-b border-border"
        />
      )}
      <div className="grid grid-cols-2">
        {cells.map(([k, v], i) => (
          <div
            key={k}
            className={`px-2 py-1 border-border min-w-0
              ${i % 2 === 0 ? "border-r" : ""}
              ${i < cells.length - 2 ? "border-b" : ""}`}
          >
            <div className="text-[8px] font-mono text-muted-foreground uppercase leading-[10px]">
              {k}
            </div>
            <div className="text-[10px] leading-[14px] truncate">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Word of the day, then the day's Wikipedia articles, then the facts.
 *  Each row carries a pill so the three sources stay distinguishable in a
 *  single stacked list. */
export function AlmanacMini({
  word,
  pages,
  facts,
}: {
  word: WordPayload | null;
  pages: WikipediaPayload[];
  facts: FactPayload[];
}) {
  const row = "px-2 py-1 border-b border-border last:border-0";

  return (
    <div>
      {word && (
        <a
          href={word.link ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={`${row} block group hover:bg-secondary/50 transition-colors`}
        >
          {/* Pill is its own column so the definition wraps beside it rather
              than underneath, matching the Wiki and Fact rows. */}
          <div className="flex gap-1.5 items-center">
            <Pill label="Word" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-[11px] font-black leading-tight group-hover:underline"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  {word.title}
                </span>
                {word.part_of_speech && (
                  <span className="text-[8px] font-mono italic text-muted-foreground">
                    {word.part_of_speech}
                  </span>
                )}
              </div>
              {word.definition && (
                <p className="text-[10px] leading-[13px] text-muted-foreground line-clamp-2">
                  {word.definition}
                </p>
              )}
            </div>
          </div>
        </a>
      )}

      {pages.map((p) => (
        <a
          key={p.title}
          href={p.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={`${row} flex gap-1.5 items-center group hover:bg-secondary/50 transition-colors`}
        >
          <Pill label="Wiki" />
          <ThumbImage
            src={p.thumbnail}
            className="w-6 h-6 object-cover border border-border shrink-0"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold leading-[13px] line-clamp-1 group-hover:underline">
              {p.title}
            </p>
            {p.description && (
              <p className="text-[8px] font-mono text-muted-foreground leading-[11px] line-clamp-1">
                {p.description}
              </p>
            )}
          </div>
        </a>
      ))}

      {facts.map((f) => (
        <div key={f.text} className={`${row} flex gap-1.5 items-center`}>
          <Pill label="Fact" />
          <span className="flex items-center h-[26px] min-w-0">
            <span className="text-[10px] leading-[13px] line-clamp-2">{f.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** On This Day, compact: year gutter + event text. */
export function OnThisDayMini({ events }: { events: OnThisDayEvent[] }) {
  return (
    <div>
      {events.slice(0, 5).map((e, i) => {
        const body = (
          <>
            <span
              className="text-[10px] font-mono font-bold tabular-nums shrink-0 w-8 leading-[13px]"
              style={{ color: MISC_ACCENT }}
            >
              {e.year}
            </span>
            {/* Fixed two-line box, not just line-clamp: clamping only caps the
                height, so a one-line event still rendered a shorter row and the
                list came out ragged. h-[26px] == 2 x leading-[13px]. */}
            <span className="flex items-center h-[26px] min-w-0">
              <span className="text-[10px] leading-[13px] line-clamp-2">{e.text}</span>
            </span>
          </>
        );
        const cls =
          "flex items-center gap-1.5 px-2 py-1 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group";
        return e.url ? (
          <a key={`${e.year}-${i}`} href={e.url} target="_blank" rel="noopener noreferrer" className={cls}>
            {body}
          </a>
        ) : (
          <div key={`${e.year}-${i}`} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
