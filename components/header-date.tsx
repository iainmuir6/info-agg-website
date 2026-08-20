"use client";

import { useSyncExternalStore } from "react";

/**
 * Masthead date in the reader's own timezone.
 *
 * The server has no way to know the visitor's timezone, so it renders an
 * Eastern-time string and this swaps in the local one after mount. Starting
 * from the server value keeps the first paint identical on both sides (no
 * hydration mismatch) and leaves ET as the fallback if anything about
 * Intl/timezone resolution fails.
 *
 * Two variants render, toggled by breakpoint: the full spelled-out date from
 * sm up, and a compact "THU, AUG 20, 2026" on mobile where the masthead has
 * to share the row with the sync indicator.
 */
type Variant = "long" | "short";

const FORMATS: Record<Variant, Intl.DateTimeFormatOptions> = {
  long: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  short: { weekday: "short", year: "numeric", month: "short", day: "numeric" },
};

/** Cached so getSnapshot returns a referentially stable value on every render
 *  (an uncached toLocaleDateString call would be recomputed each time). Empty
 *  string is the sentinel for "Intl failed", which falls back to the server
 *  string. Module scope is fine: every instance wants the same current date. */
const cachedLocalDate: Partial<Record<Variant, string>> = {};

function localDateLabel(variant: Variant): string {
  if (cachedLocalDate[variant] === undefined) {
    try {
      cachedLocalDate[variant] = new Date()
        .toLocaleDateString(undefined, FORMATS[variant])
        .toUpperCase();
    } catch {
      cachedLocalDate[variant] = "";
    }
  }
  return cachedLocalDate[variant]!;
}

/** Nothing to subscribe to — the local date is read once after hydration. */
const NO_OP_SUBSCRIBE = () => () => {};

export function HeaderDate({
  initialLong,
  initialShort,
}: {
  initialLong: string;
  initialShort: string;
}) {
  const longLabel = useSyncExternalStore(
    NO_OP_SUBSCRIBE,
    () => localDateLabel("long") || initialLong,
    () => initialLong,
  );
  const shortLabel = useSyncExternalStore(
    NO_OP_SUBSCRIBE,
    () => localDateLabel("short") || initialShort,
    () => initialShort,
  );

  return (
    <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
      <span className="hidden sm:inline">{longLabel}</span>
      <span className="sm:hidden">{shortLabel}</span>
    </span>
  );
}
