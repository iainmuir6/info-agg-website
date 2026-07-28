"use client";

import { useEffect } from "react";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-24 text-center">
      <div className="rule-double mb-6" />
      <h2
        className="text-2xl font-black tracking-tight mb-2"
        style={{ fontFamily: "Georgia, serif" }}
      >
        Something went wrong
      </h2>
      <p className="text-sm text-muted-foreground font-mono mb-6">
        This section failed to load. The rest of the site is unaffected — try
        again, or come back in a moment.
      </p>
      <button
        onClick={reset}
        className="text-[10px] font-mono tracking-widest uppercase border border-border px-4 py-2 hover:border-foreground transition-colors"
      >
        Try again
      </button>
      {error.digest && (
        <p className="mt-6 text-[10px] font-mono text-muted-foreground/60">
          Ref: {error.digest}
        </p>
      )}
    </div>
  );
}
