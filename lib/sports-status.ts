import { APP_TIME_ZONE, easternDayKey, isTodayEastern } from "@/lib/format-date";

/** Game start time in Eastern, tight-packed with no space before AM/PM
 *  ("7:30 PM" → "7:30PM") — saves width in narrow score-row cells. */
export function formatGameTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE })
    .replace(" ", "");
}

/** True when a game's Eastern calendar date matches today's — compares by
 *  the same locale/timezone rendering rather than raw Date subtraction, so
 *  a 11pm ET game and a same-day midnight UTC read don't drift a day apart. */
export function isGameToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true;
  return isTodayEastern(dateStr);
}

/** Sortable Eastern calendar-day key ("2026-07-29") — en-CA gives ISO order,
 *  and Eastern matches the timezone every game date is rendered in. */
export function easternDay(dateStr: string | null | undefined): string {
  return easternDayKey(dateStr);
}

/**
 * Every game on the *leading* calendar day of a list — the most recent day that
 * has results (`"desc"`), or the next day that has fixtures (`"asc"`).
 *
 * This replaces an arbitrary `slice(0, N)`. A fixed count silently hides part of
 * a slate: MLB routinely plays 16 games a day, so "the 6 most recent" showed
 * less than half of one day while also mixing in games from previous days. A
 * day is the unit a reader actually thinks in, and it self-sizes per league.
 *
 * Undated rows are ignored when picking the day, and excluded from the result
 * (they can't belong to a day). If nothing has a date, the input is returned
 * unchanged rather than emptied.
 */
export function leadingDaySlate<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  direction: "desc" | "asc",
): T[] {
  const days = items.map((i) => easternDay(getDate(i))).filter((d) => d !== "");
  if (days.length === 0) return items;
  const target = days.reduce((best, d) =>
    direction === "desc" ? (d > best ? d : best) : (d < best ? d : best),
  );
  return items.filter((i) => easternDay(getDate(i)) === target);
}

/** Human label for a day key from `easternDay` ("2026-07-29" → "Jul 29"). */
export function formatDayKey(dayKey: string): string {
  if (!dayKey) return "";
  // Parse as local noon so the key's own calendar date can't shift a day.
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Short Eastern calendar date for a game that isn't today ("8/7"). */
export function formatGameDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/** Compact a live game status so it fits a narrow status column.
 *
 *  ESPN's status_detail is verbose ("1:21 - 1st Quarter", "Top 1st"), and a
 *  single narrow line truncates it to noise like "1:21 -". Splitting it into
 *  two short lines uses the cell's height instead of its width.
 *
 *    "1:21 - 1st Quarter" → 1:21 / 1st
 *    "Top 1st"            → ▲    / 1st
 *    "Bot 4th"            → ▼    / 4th
 *    "End of 2nd"         → End  / 2nd
 */
export type CompactStatus = { top: string; bottom: string };

export function compactStatus(detail: string | null | undefined): CompactStatus {
  const s = (detail ?? "").trim();
  if (!s) return { top: "LIVE", bottom: "" };

  const half = s.match(/^(Top|Bot(?:tom)?|Mid(?:dle)?)\s+(.*)$/i);
  if (half) {
    const marker = /^top$/i.test(half[1]) ? "▲" : /^mid/i.test(half[1]) ? "•" : "▼";
    return { top: marker, bottom: shortPeriod(half[2]) };
  }

  // "1:21 - 1st Quarter" / "1:21 - 1st"
  const clocked = s.match(/^([\d:]+)\s*-\s*(.*)$/);
  if (clocked) return { top: clocked[1], bottom: shortPeriod(clocked[2]) };

  const endOf = s.match(/^End\s+of\s+(.*)$/i);
  if (endOf) return { top: "End", bottom: shortPeriod(endOf[1]) };

  if (/^half/i.test(s)) return { top: "Half", bottom: "" };

  const words = s.split(/\s+/);
  if (words.length === 1) return { top: shortPeriod(s), bottom: "" };
  return { top: words[0], bottom: shortPeriod(words.slice(1).join(" ")) };
}

function shortPeriod(p: string): string {
  return p
    .replace(/\bQuarter\b/i, "")
    .replace(/\bPeriod\b/i, "")
    .replace(/\bInning\b/i, "")
    .replace(/\bHalf\b/i, "H")
    .trim();
}


/** Multi-word nicknames that must not be reduced to their last word. */
const TWO_WORD_NICKNAMES = new Set([
  "red sox", "white sox", "blue jays", "maple leafs", "trail blazers",
  "golden knights", "red wings", "blue jackets", "sun devils", "golden bears",
  "crimson tide", "tar heels", "fighting irish", "nittany lions", "buffalo bills",
]);

/**
 * Strip the city from a full team name: "Dallas Wings" → "Wings",
 * "Boston Red Sox" → "Red Sox". Used where horizontal space is tight
 * (mobile score rows) and the city adds no information.
 */
export function teamNickname(fullName: string): string {
  const name = (fullName ?? "").trim();
  if (!name) return "";
  const words = name.split(/\s+/);
  if (words.length <= 1) return name;

  const lastTwo = words.slice(-2).join(" ").toLowerCase();
  if (words.length > 2 && TWO_WORD_NICKNAMES.has(lastTwo)) {
    return words.slice(-2).join(" ");
  }
  return words[words.length - 1];
}
