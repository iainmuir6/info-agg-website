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

**Not currently wired into the UI.** No file in this directory is referenced by `app/`,
`components/`, or `lib/` (verified by grepping for `/assets/` and each filename above) — these
were staged ahead of building expandable-section headers and a weather widget, neither of
which currently render a logo or icon from here. Treat this as available assets, not evidence
of what's live.

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
