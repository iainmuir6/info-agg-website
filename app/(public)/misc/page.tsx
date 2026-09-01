import { getMiscContent } from "@/lib/misc-content";
import {
  CountryCard,
  FactCard,
  HolidaysCard,
  MISC_ACCENT,
  OnThisDayCard,
  WeatherCard,
  WikipediaCard,
  WordCard,
} from "@/components/misc-cards";

export default async function MiscPage() {
  const misc = await getMiscContent();

  const cards = [
    ...misc.weather.map((w) => (
      <WeatherCard key={`weather-${w.key}`} city={w.key} data={w.payload} />
    )),
    misc.holidays.length > 0 && (
      <HolidaysCard key="holidays" holidays={misc.holidays} />
    ),
    misc.country && <CountryCard key="country" country={misc.country} />,
    misc.word && <WordCard key="word" word={misc.word} />,
    misc.onThisDay.length > 0 && (
      <OnThisDayCard key="onthisday" events={misc.onThisDay} />
    ),
    misc.wikipedia.length > 0 && (
      <WikipediaCard key="wikipedia" pages={misc.wikipedia} />
    ),
    misc.facts.length > 0 && <FactCard key="fact" facts={misc.facts} />,
  ].filter(Boolean);

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-8">
      <div>
        <div className="rule-double mb-3" />
        <div className="flex items-baseline justify-between">
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: "Georgia, serif" }}
          >
            <span style={{ color: MISC_ACCENT }}>◎</span> MISC
          </h2>
          {misc.fetchedAt && (
            <span className="text-xs font-mono text-muted-foreground">
              {new Date(misc.fetchedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-wider">
          WEATHER · HOLIDAYS · COUNTRY · WORD · ON THIS DAY · WIKIPEDIA · FACTS
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="border border-border p-12 text-center">
          <p className="text-xs font-mono text-muted-foreground tracking-wider">
            NO MISC DATA YET
          </p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-3">
            The next scheduled sync should populate this page — check back shortly.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-px bg-border border border-border">
          {cards}
        </div>
      )}
    </div>
  );
}
