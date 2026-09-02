"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useState } from "react";
import {
  AuthError,
  AuthField,
  AuthLink,
  AuthPanel,
  AuthSubmit,
} from "@/components/auth/auth-ui";

/**
 * A real browser form POST to /auth/sign-in — not an XHR, and not a server
 * action (React would intercept that with fetch and there would be no
 * navigation). The navigation is the point: it is what makes iOS offer to
 * save the password, and it is what lets the session cookie arrive as a
 * server Set-Cookie instead of being written from script and capped at seven
 * days by WebKit. See app/auth/sign-in/route.ts.
 *
 * The inputs are uncontrolled on purpose. A password manager fills a field by
 * setting its value directly, and controlled React inputs are the classic way
 * that fill gets reverted on the next render.
 */
export function LoginForm({
  error,
  next,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  error?: string;
  next?: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <div className={cn(className)} {...props}>
      <AuthPanel
        eyebrow="Sign In"
        title="Welcome back."
        description="Your watchlist, favourite teams and dashboard layout are waiting."
        footer={
          <>
            No account yet? <AuthLink href="/auth/sign-up">Create one</AuthLink>
          </>
        }
      >
        <form
          method="post"
          action="/auth/sign-in"
          // No preventDefault anywhere: the browser must perform this
          // submission itself for any of the above to hold.
          onSubmit={() => setPending(true)}
          className="flex flex-col gap-4"
        >
          {next && <input type="hidden" name="next" value={next} />}

          <AuthField
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@example.com"
            required
          />

          <AuthField
            id="current-password"
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            revealable
            action={
              <Link
                href="/auth/forgot-password"
                className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                Forgot?
              </Link>
            }
          />

          {error && <AuthError>{error}</AuthError>}

          <AuthSubmit
            pending={pending}
            pendingLabel="Signing in"
            disableWhilePending={false}
          >
            Sign in
          </AuthSubmit>
        </form>
      </AuthPanel>
    </div>
  );
}
