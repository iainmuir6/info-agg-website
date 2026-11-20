// The Info Hub's public demo tour, signed in as the demo User (scripts/demo-accounts.ts), whose login is in demo mode:
// the weather cards show stand-in cities with made-up readings (lib/demo/weather.ts). Everything else is public news,
// sports and market data. No admin page (/dashboard) is opened. Selectors are the app's own hrefs, labels and text.
import type { Demo } from "./engine";

/** The local dev server draws Next's "N" dev indicator; keep it off camera (production has none). */
async function hideDevChrome(d: Demo) {
  const css = "nextjs-portal{display:none!important}";
  await d.page.context().addInitScript({
    content: `addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.append(s);});`,
  });
}

/** Hold until the page's own content (not its loading shell) is on screen, then let the viewer read it. */
async function loaded(d: Demo, selector: string, hold: number) {
  await d.page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
  await d.settle();
  await d.pause(hold);
}

export async function publicTour(d: Demo) {
  await hideDevChrome(d);

  // Command Center: the AI briefing, headlines, scores and the favorite stocks and teams, all on one page.
  await d.goto("/", 2800);
  await d.hover('a[href="/summary"] >> nth=0', 900);
  await d.pause(1200);
  await d.scrollBy(620, 2200);
  await d.pause(1800);
  await d.scrollBy(700, 2200);
  await d.pause(1800);
  await d.scrollToTop();

  // The two AI briefings in full.
  await d.click('a[href="/summary"] >> nth=0', 3500);
  await d.scrollBy(320, 1500);
  await d.pause(1200);

  // Sports: a league's standings and scores, then a favorite team.
  await d.click('nav a[href="/sports"]', 300);
  await loaded(d, 'main a[href="/nba"]', 2400);
  await d.click('main a[href="/nba"] >> nth=0', 300);
  await loaded(d, 'main a[href="/nba/BOS"]', 2400);
  await d.click('main a[href="/nba/BOS"] >> nth=0', 3000);
  await d.scrollBy(400, 1600);
  await d.pause(1200);

  // Markets: the watchlist with favorites on top, then one stock's history.
  await d.click('nav a[href="/markets"]', 2600);
  await d.click('main a[href="/markets/NVDA"] >> nth=0', 2600);
  await d.click('main button:has-text("2M")', 2000);
  await d.click('main button:has-text("1W")', 2000);

  // News: the full NYT feed, filtered by section.
  await d.click('nav a[href="/news"]', 300);
  await loaded(d, 'main a[target="_blank"]', 2000);
  await d.click('main button:has-text("TECHNOLOGY")', 2400);
  await d.scrollBy(500, 1800);
  await d.pause(1000);

  // Media: trending YouTube.
  await d.click('nav a[href="/media"]', 2600);
  await d.scrollBy(450, 1800);
  await d.pause(1000);

  // Misc (Almanac): weather (demo stand-ins), holidays, country of the day, word, Wikipedia.
  await d.click('nav a[href="/misc"]', 3200);
  await d.scrollBy(520, 2000);
  await d.pause(2200);

  // Profile: favorites and the Command Center layout.
  await d.click('a[href="/profile"]', 300);
  await loaded(d, 'main :text("Favorites")', 4000);

  await d.click('a[href="/"] >> nth=0', 300);
  await loaded(d, 'a[href="/summary"]', 3000);
}
