"use client";

import { useState } from "react";

/**
 * Shows the full text of a clamped element on hover.
 *
 * Positioned `fixed` rather than `absolute` on purpose: CollapsibleCard wraps
 * its body in `overflow-hidden` (that is what makes the collapse animation
 * work), which would clip an absolutely positioned popover to the card. A
 * fixed element escapes ancestor overflow entirely — it is only trapped by an
 * ancestor with a transform/filter, and there is none on this path.
 *
 * Coordinates are captured on enter instead of tracking the pointer, so the
 * panel stays put while the reader moves onto it and does not jitter.
 */
export function HoverReveal({
  children,
  content,
  className,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
}) {
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);

  return (
    <div
      className={className}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setBox({ left: r.left, top: r.bottom });
      }}
      onMouseLeave={() => setBox(null)}
    >
      {children}
      {box && (
        <div
          role="tooltip"
          // pointer-events-none: the panel overlaps the rows beneath it, and
          // without this it would swallow their own hover.
          className="pointer-events-none fixed z-50 w-[300px] border border-border bg-card p-2 shadow-lg"
          style={{
            // Keep it on screen in the rightmost column, and flip above the
            // row when there is no room below it.
            left: Math.min(box.left, window.innerWidth - 310),
            top:
              box.top + 140 > window.innerHeight
                ? Math.max(8, box.top - 150)
                : box.top + 4,
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
