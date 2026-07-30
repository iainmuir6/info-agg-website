/**
 * Date/time formatting, pinned to one timezone per value type.
 *
 * Two failure modes this exists to prevent, both of which the app had:
 *
 * 1. INSTANTS (`timestamptz` columns — fetched_at, published_at, game_date,
 *    quote_timestamp, started_at) formatted with no `timeZone` option render in
 *    whatever zone the *formatting machine* is in. That is the reader's zone in
 *    a client component, but UTC on a server component in production — so a
 *    9:05am ET sync showed as "1:05 PM", and two panels on the same page could
 *    disagree by four hours. Always format these through the ET helpers below:
 *    the masthead, game times and market "as of" stamps are already Eastern, so
 *    Eastern is the app's editorial timezone.
 *
 * 2. DATE-ONLY strings (`date` columns — economic_indicators.date,
 *    etf_holdings.as_of_date, "2026-07-30") are parsed by `new Date()` as UTC
 *    midnight. Formatting that in Eastern moves it *back* five hours and prints
 *    the PREVIOUS day. These must be formatted in UTC, which is the only zone
 *    where the parsed instant still lands on the date the string names. Use the
 *    `*DateOnly` helpers, never the ET ones.
 *
 * Because every helper names its zone explicitly, output no longer depends on
 * where the code runs, so server and client renders agree.
 */

export const APP_TIME_ZONE = "America/New_York";

function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ── Instants (timestamptz) — always Eastern ─────────────────────────────── */

/** "Jul 30" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/** "Jul 30, 2026" */
export function formatDateLong(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/** "9:05 AM" — pass `withZone` to append "EDT"/"EST". */
export function formatTime(
  value: string | Date | null | undefined,
  withZone = false,
): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
    ...(withZone ? { timeZoneName: "short" as const } : {}),
  });
}

/** "Jul 30, 9:05 AM" */
export function formatDateTime(
  value: string | Date | null | undefined,
  withZone = false,
): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
    ...(withZone ? { timeZoneName: "short" as const } : {}),
  });
}

/** "Thu, Jul 30, 09:05 AM" — used where a weekday aids scanning. */
export function formatWeekdayDateTime(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** "Jul 26" style label for chart axes. */
export function formatChartDay(value: string | Date | null | undefined): string {
  return formatDate(value);
}

/** Eastern calendar-day key ("2026-07-30"), sortable as a string. */
export function easternDayKey(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** True when the instant falls on today's Eastern calendar day. */
export function isTodayEastern(value: string | Date | null | undefined): boolean {
  const key = easternDayKey(value);
  return key !== "" && key === easternDayKey(new Date());
}

/** Coarse age of an instant: "just now" / "12 min ago" / "3 h ago" / "2 d ago". */
export function formatAge(value: string | Date | null | undefined, never = "never"): string {
  const d = safeDate(value);
  if (!d) return never;
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

/* ── Date-only values (date columns) — always UTC ────────────────────────── */

/** "Jul 30" for a "2026-07-30" string. */
export function formatDateOnly(value: string | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Jul 30, 2026" for a "2026-07-30" string. */
export function formatDateOnlyLong(value: string | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Jul '26" for a "2026-07-30" string — compact axis label for monthly series. */
export function formatMonthOnly(value: string | null | undefined): string {
  const d = safeDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}
