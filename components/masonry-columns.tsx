"use client";

import { Children, ReactNode, useEffect, useRef, useState } from "react";

function getColCount(): number {
  if (typeof window === "undefined") return 1;
  if (window.innerWidth >= 1280) return 5;
  if (window.innerWidth >= 768) return 3;
  return 1;
}

/**
 * Distributes children into N flex columns using round-robin assignment.
 * Items are pinned to their column — they can never jump to a different one
 * regardless of height changes, unlike CSS `columns` which reflows freely.
 * When a card above collapses, the card directly below slides up smoothly
 * because they share a flex-col container.
 */
export function MasonryColumns({ children }: { children: ReactNode }) {
  const [cols, setCols] = useState(1);
  // Track whether we've mounted so SSR (cols=1) and first client render match
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      setCols(getColCount());
    }
    const onResize = () => setCols(getColCount());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const items = Children.toArray(children).filter(Boolean);

  if (cols === 1) {
    return <div className="flex flex-col gap-3">{items}</div>;
  }

  // Round-robin: item 0 → col 0, item 1 → col 1, …, item N → col (N % cols)
  const columns: ReactNode[][] = Array.from({ length: cols }, () => []);
  items.forEach((item, i) => columns[i % cols].push(item));

  return (
    <div className="flex gap-3 items-start">
      {columns.map((colItems, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-3 min-w-0">
          {colItems}
        </div>
      ))}
    </div>
  );
}
