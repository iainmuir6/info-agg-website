"use client";

import { useEffect, useState } from "react";

/**
 * Masthead date in the reader's own timezone.
 *
 * The server has no way to know the visitor's timezone, so it renders an
 * Eastern-time string and this swaps in the local one after mount. Starting
 * from the server value keeps the first paint identical on both sides (no
 * hydration mismatch) and leaves ET as the fallback if anything about
 * Intl/timezone resolution fails.
 */
export function HeaderDate({ initial }: { initial: string }) {
  const [label, setLabel] = useState(initial);

  useEffect(() => {
    try {
      setLabel(
        new Date()
          .toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })
          .toUpperCase(),
      );
    } catch {
      // keep the server-rendered ET string
    }
  }, []);

  return (
    <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
      {label}
    </span>
  );
}
