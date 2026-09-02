"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for the four auth screens.
 *
 * The rest of the site is hairline borders, zero radius, mono micro-labels and
 * a Georgia masthead; the auth pages were still stock shadcn Cards with 2xl
 * headings, so they read as a different product. These primitives are the same
 * vocabulary as SectionCard on the public pages — a bordered panel with a
 * colour-spined header strip — sized up slightly, because a login screen is
 * one thing on an empty page rather than a cell in a dense grid.
 */

const ACCENT = "hsl(220 90% 52%)"; // the news blue, already the "account" accent on /profile

/* ------------------------------------------------------------------ panel */

export function AuthPanel({
  eyebrow,
  title,
  description,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full animate-fade-in-up">
      <div className="border border-border bg-card">
        {/* Header strip — accent spine, mono tag, live dot */}
        <div
          className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-border"
          style={{ borderLeftColor: ACCENT, borderLeftWidth: 3 }}
        >
          <span className="text-[10px] font-mono tracking-widest uppercase font-bold">
            {eyebrow}
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0"
            style={{ backgroundColor: ACCENT }}
            aria-hidden
          />
        </div>

        <div className="px-4 sm:px-5 py-4 sm:py-5">
          <h1
            className="text-2xl sm:text-[28px] font-black tracking-tight leading-none"
            style={{ fontFamily: "Georgia, serif" }}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-[11px] font-mono leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}

          <div className="mt-5">{children}</div>
        </div>

        {footer && (
          <div className="px-4 sm:px-5 py-2.5 border-t border-border bg-secondary/40">
            <div className="text-[11px] font-mono text-muted-foreground text-center">
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ field */

type FieldProps = Omit<React.ComponentPropsWithoutRef<"input">, "className"> & {
  label: string;
  /** Rendered on the label row, flush right — e.g. the "forgot password?" link. */
  action?: React.ReactNode;
  /** Adds the eye toggle. Only meaningful for type="password". */
  revealable?: boolean;
};

export function AuthField({ label, action, revealable, id, type, ...props }: FieldProps) {
  const [revealed, setRevealed] = React.useState(false);
  const resolvedType = revealable && revealed ? "text" : type;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <label
          htmlFor={id}
          className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground"
        >
          {label}
        </label>
        {action && <span className="ml-auto">{action}</span>}
      </div>

      <div className="relative">
        <input
          id={id}
          type={resolvedType}
          {...props}
          className={cn(
            // Typed text and placeholder share one size, so the field does not
            // visibly change scale the moment you start typing into it.
            //
            // Knowing trade-off: iOS Safari zooms the page on focus for any
            // input under 16px. The 16px alternative needed the placeholder
            // shrunk separately, which read as two type scales in one control.
            // If the zoom becomes a problem, the lever is `maximum-scale=1` on
            // the viewport -- see the note in CLAUDE.md before reaching for it.
            "w-full bg-transparent border border-border px-2.5 py-2",
            "text-[12px] font-mono",
            "outline-none transition-colors",
            "placeholder:text-muted-foreground/60",
            "focus:border-foreground",
            revealable && "pr-16",
          )}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            tabIndex={-1}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- submit */

export function AuthSubmit({
  children,
  pending,
  pendingLabel,
  disabled,
}: {
  children: React.ReactNode;
  pending?: boolean;
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "w-full flex items-center justify-center gap-2 px-3 py-2.5",
        "bg-foreground text-background",
        "text-[10px] font-mono font-bold tracking-[0.2em] uppercase",
        "transition-opacity hover:opacity-85 disabled:opacity-40",
      )}
    >
      {pending ? (
        <>
          {pendingLabel}
          <span className="animate-blink-cursor" aria-hidden>
            _
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

/* ---------------------------------------------------------------- notices */

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="border px-2.5 py-2 text-[11px] font-mono leading-snug"
      style={{ color: "hsl(0 72% 50%)", borderColor: "hsl(0 72% 50% / 0.45)" }}
    >
      {children}
    </p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-mono text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors"
    >
      {children}
    </Link>
  );
}
