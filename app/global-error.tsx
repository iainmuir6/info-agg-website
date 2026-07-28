"use client";

// Root-level boundary: catches errors thrown by the root layout itself.
// Must render its own <html>/<body> because the layout did not mount.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "monospace", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          Info Hub is unavailable
        </h2>
        <p style={{ opacity: 0.7, fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          An unexpected error occurred{error.digest ? ` (ref ${error.digest})` : ""}.
        </p>
        <button
          onClick={reset}
          style={{
            border: "1px solid currentColor",
            background: "none",
            padding: "0.5rem 1rem",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
