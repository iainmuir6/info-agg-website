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
