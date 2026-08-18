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
 */
/** Cached so getSnapshot returns a referentially stable value on every render
 *  (an uncached toLocaleDateString call would be recomputed each time). Empty
 *  string is the sentinel for "Intl failed", which falls back to the server
 *  string. Module scope is fine: every instance wants the same current date. */
let cachedLocalDate: string | undefined;

function localDateLabel(): string {
  if (cachedLocalDate === undefined) {
    try {
      cachedLocalDate = new Date()
        .toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
        .toUpperCase();
    } catch {
      cachedLocalDate = "";
    }
  }
  return cachedLocalDate;
}

/** Nothing to subscribe to — the local date is read once after hydration. */
const NO_OP_SUBSCRIBE = () => () => {};

export function HeaderDate({ initial }: { initial: string }) {
  const label = useSyncExternalStore(
    NO_OP_SUBSCRIBE,
    () => localDateLabel() || initial,
    () => initial,
  );

  return (
    <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
      {label}
    </span>
  );
}
