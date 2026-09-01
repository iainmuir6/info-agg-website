import type {
  CountryPayload,
  FactPayload,
  Holiday,
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

const glyph = (icon: string | null | undefined) =>
  (icon && WEATHER_GLYPH[icon]) || "○";

function CardShell({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-background p-4 flex flex-col">
      <div className="flex items-baseline justify-between gap-2 mb-3">
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
  // The ETL key ("New York,NY") is the fallback; the resolved address is
  // friendlier but can be long, so trim it to city + region.
  const label =
    data.resolved_address?.split(",").slice(0, 2).join(", ") ?? city;

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
          {data.forecast.slice(0, 5).map((d) => (
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
                {round(d.tempmax)}°
                <span className="text-muted-foreground">/{round(d.tempmin)}°</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

export function HolidaysCard({ holidays }: { holidays: Holiday[] }) {
  return (
    <CardShell title="Upcoming Holidays" meta={`${holidays.length}`}>
      <ul className="space-y-2">
        {holidays.slice(0, 6).map((h) => (
          <li key={`${h.date}-${h.name}`} className="flex gap-3 items-baseline">
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0 w-14">
              {new Date(`${h.date}T12:00:00`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="text-xs leading-snug">{h.name}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function WikipediaCard({ page }: { page: WikipediaPayload }) {
  return (
    <CardShell title="From Wikipedia" meta="RANDOM">
      <a
        href={page.url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="group block"
      >
        <p
          className="text-base font-bold leading-tight group-hover:underline"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {page.title}
        </p>
        {page.description && (
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mt-0.5">
            {page.description}
          </p>
        )}
        {page.extract && (
          <p className="text-xs leading-relaxed text-muted-foreground mt-2 line-clamp-6">
            {page.extract}
          </p>
        )}
      </a>
    </CardShell>
  );
}

export function CountryCard({ country }: { country: CountryPayload }) {
  const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString());
  const rows: [string, string][] = [
    ["CAPITAL", country.capital ?? "—"],
    ["REGION", [country.region, country.subregion].filter(Boolean).join(" · ") || "—"],
    ["POPULATION", fmt(country.population)],
    ["AREA", country.area_km2 ? `${fmt(country.area_km2)} km²` : "—"],
    ["LANGUAGES", country.languages.slice(0, 3).join(", ") || "—"],
    [
      "CURRENCY",
      country.currencies
        .map((c) => [c.code, c.symbol && `(${c.symbol})`].filter(Boolean).join(" "))
        .join(", ") || "—",
    ],
  ];

  return (
    <CardShell title="Country of the Day" meta={country.cca2}>
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
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 items-baseline">
            <dt className="text-[9px] font-mono text-muted-foreground w-20 shrink-0">
              {k}
            </dt>
            <dd className="text-xs leading-snug">{v}</dd>
          </div>
        ))}
      </dl>
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
          className="text-2xl font-black leading-tight group-hover:underline"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {word.title}
        </p>
        {word.description && (
          <p className="text-xs leading-relaxed text-muted-foreground mt-2 line-clamp-5">
            {word.description}
          </p>
        )}
      </a>
    </CardShell>
  );
}

export function FactCard({ fact }: { fact: FactPayload }) {
  return (
    <CardShell title="Useless Fact" meta="DID YOU KNOW">
      <p
        className="text-sm leading-relaxed"
        style={{ fontFamily: "Georgia, serif" }}
      >
        {fact.text}
      </p>
      {fact.source && (
        <p className="text-[10px] font-mono text-muted-foreground mt-2">
          — {fact.source}
        </p>
      )}
    </CardShell>
  );
}
