# Assets Directory

This directory contains logos and images for different information sources.

## Structure

- `logos/news/` — `nyt.svg`/`nyt.png`, `wsj.svg`
- `logos/sports/` — `espn.svg`, `dk.svg` (DraftKings)
- `logos/markets/` — `robinhood.svg`, `fmp.svg`, `alpha_vantage.png`
- `logos/media/` — `youtube.svg`, `spotify.svg`, `x.svg`
- `website_logos/` — this app's own logo (`info_agg.svg`/`.png`), not a source logo
- `misc/weather-icons/` — a full weather-condition icon set (clear/cloudy/rain/snow/thunder ×
  day/night variants, etc.) for a weather widget

## Usage

Only `website_logos/info_agg.png` is live: it is `LOGO_SRC` in `lib/brand.ts`, the mark on the
public masthead and the auth screens. Nothing else here is referenced by `app/`, `components/`
or `lib/` — the source logos and weather icons were staged for expandable-section headers and a
weather widget that do not use them. Treat them as available assets, not evidence of what's live.

## File Formats

- Preferred: SVG (scalable, crisp at any size)
- Acceptable: PNG (with transparent background)
- Avoid: JPG (no transparency support)

## Naming Convention

Lowercase, matching the source's common short name — not always hyphenated (see `nyt.svg`,
`fmp.svg`, `dk.svg` above rather than spelled-out names like `new-york-times.svg`).

## Integration

When these are wired in, use `next/image` for optimization (per the mobile/accessibility notes
in `docs/IMPROVEMENT_PLAN.md` §2.4 — the app currently uses raw `<img>` for external images).
