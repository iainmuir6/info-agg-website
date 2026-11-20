# Demo Video: Process

How the Info Hub demo video is made: a scripted, re-runnable screen recording, polished afterwards in Descript.
The method is app-stack's `demo-video` skill (its `scripts/engine.ts` is copied here as is); pathway-hub's
`docs/demo-video.md` is the worked example this follows.

## Decisions (Iain, 2026-11-20)
- **Public / external cut only.** No internal (Admin) cut for this app.
- **Signed in as a plain User in demo mode** (`app_metadata.demo`), never the super admin. No admin page
  (`/dashboard`, `/dashboard/activity`) is shown; for a plain User those redirect home anyway.
- **What is personal here:** almost nothing. News, sports, markets, media and the almanac are public data shown to
  every visitor. The one exception is the **weather cards**: the six cities the ETL fetches (`WEATHER_LOCATIONS`) are
  places Iain has ties to. Demo mode swaps them for six stand-in cities with made-up readings. Favorites are the demo
  account's own (three stocks, two teams), not Iain's.
- **No API calls are made by a take.** The tour only reads what the ETL already stored; it never triggers the ETL, AI
  briefings or any external fetch (several upstreams have small monthly quotas).

## Files
| File | What |
| --- | --- |
| `scripts/demo-accounts.ts` | Makes or refreshes the demo login (re-runnable). Password goes only to `private/demo-accounts.json` (git-ignored, mode 600). |
| `scripts/demo/engine.ts` | App-agnostic recorder from app-stack `demo-video`: sign-in once, visible cursor, eased moves, smooth scrolls, step log, CDP screencast to MP4. Copied as is. |
| `scripts/demo/infohub.ts` | Info Hub specifics: reading the login, the sign-in form. |
| `scripts/demo/tours.ts` | The public tour, as plain steps (`goto`, `click`, `scrollBy`, `pause`). |
| `scripts/demo/record.ts` | `pnpm tsx scripts/demo/record.ts public [baseUrl]` → `private/demo-videos/infohub-public.mp4`. |
| `scripts/demo/scout.ts` | Screenshots each route as the demo login, to write a tour against what is really on screen. |
| `lib/demo/viewer.ts` | `isDemoViewer()`: the `app_metadata.demo` flag, honoured only below super admin. |
| `lib/demo/weather.ts` | Demo mode for the weather cards; `lib/demo/seed.ts` is the shared hash. |
| `lib/demo/weather.test.ts` | Asserts no real city, address, timezone or reading survives (`pnpm test`). |

## Steps

### 1. Tools
- `brew install ffmpeg` (free). `@playwright/test` and `tsx` are dev dependencies.
- The recorder drives **installed Google Chrome** (`channel: "chrome"`), not Playwright's Chromium (no H.264, so
  YouTube and Spotify embeds may not play).

### 2. Demo login
- `pnpm tsx scripts/demo-accounts.ts` (add `--rotate` for a new password). It makes `infohub.demo@example.com` the
  way the open sign-up does (a confirmed auth user with no project role), sets `display_name` "Demo User" and
  `app_metadata.demo`, and favorites NVDA, AAPL, MSFT, the Boston Celtics and the Kansas City Chiefs (written as the
  account itself under RLS, as the star buttons do).
- The app lists no people anywhere, so there is no hidden-accounts list to add it to.

### 3. Demo mode (weather only)
- `getMiscContent` (`lib/misc-content.ts`) reads the viewer with `isDemoViewer` alongside its query and, for a demo
  viewer, passes the sorted weather rows through `demoWeather`: the six real cities become London, Tokyo, Paris,
  Sydney, Toronto and Los Angeles, and every reading (temperature, feels-like, humidity, wind, conditions, forecast
  values) is a deterministic fake from a hash of the stand-in city and fetch day. Forecast dates stay real so the
  weekday strip is right. Address, timezone, sunrise and sunset are dropped.
- That one reader feeds both places weather shows (the Command Center's Weather card and `/misc`), and it runs per
  request after the query, so nothing fake is cached or written back.
- Honoured only below super admin, so an admin login never sees fake data.

### 4. Scout, then write the tour
- `DEMO_BASE_URL=http://127.0.0.1:3007 pnpm tsx scripts/demo/scout.ts user <outDir> / /news /sports /nba /markets …`
  (add `FULL=1` for full-page shots). Use a fresh `<outDir>`: a shared scratch folder can hold another app's shots.
- Selectors are the app's own hrefs and text (`nav a[href="/markets"]`, `main a[href="/nba/BOS"]`,
  `main button:has-text("2M")`).

### 5. Record
- Until demo mode is deployed, record from the local dev server: `pnpm dev --port 3007 --hostname 127.0.0.1`, then
  `pnpm tsx scripts/demo/record.ts public`. Once deployed, pass `https://info-agg-website.vercel.app` and confirm the
  deploy is the commit with demo mode first (an old build shows the real cities).
- The tour hides Next's dev indicator (`nextjs-portal`) so a local take looks like production.
- The step log prints video time per step: a long gap is a stuck step. Visit the routes once before a local take so
  the dev server has compiled them, or the first visit sits on a loading shell on camera.
- Output: 2880 x 1800 (1440 x 900 at 2x), H.264, 30 fps, in `private/demo-videos/` (git-ignored).

### 6. Check the take
- Contact sheet: `ffmpeg -i take.mp4 -vf "fps=1/5,scale=480:-1,tile=4x5" -frames:v 1 sheet.png`, then look at it.
- Look for: idle stretches, loading shells, the wrong item clicked, and the weather cards (they must show the
  stand-in cities).

### 7. Polish in Descript
- Import the MP4 and add title cards, captions or zooms (the 2x frames leave room to zoom).

## Bugs the Takes Found (fixed in the app, 2026-11-20)
- **Stock News rows nested links.** Each Command Center Stock News row was one `<a>` with the ticker chips (links of
  their own) inside it: invalid HTML that failed hydration on every load of `/`. The row is now a `div` with a
  stretched headline link (`after:absolute after:inset-0`) and the chips lifted above it (`relative z-10`), so the
  whole row still opens the story and a chip still opens its stock.
- **Upcoming Holidays repeated a day.** Calendarific lists a holiday once per observance type, so Christmas Day showed
  four times. `asHolidays` (`lib/misc-content.ts`) keeps one row per name and date.
- **Sports page lost every league's results.** `/sports` read the ±10-day window in one query ordered by date desc
  with `limit(400)`, which the busiest leagues' far-future fixtures filled: the Scores column vanished (an empty grey
  third column) and Schedule opened five days out. It now reads each league's past and upcoming games separately
  (`app/(public)/sports/page.tsx`).
