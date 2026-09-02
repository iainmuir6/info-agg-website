"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { getAuthCallbackUrl } from "@/lib/site-url";
import {
  AuthError,
  AuthField,
  AuthLink,
  AuthPanel,
  AuthSubmit,
} from "@/components/auth/auth-ui";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      // This URL must also be listed under Supabase → Auth → URL configuration.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getAuthCallbackUrl()}?next=${encodeURIComponent("/auth/update-password")}`,
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn(className)} {...props}>
        <AuthPanel
          eyebrow="Sent"
          title="Check your inbox."
          description={
            <>
              If an account exists for{" "}
              <span className="text-foreground">{email}</span>, a reset link is
              on its way. It expires in an hour.
            </>
          }
          footer={<AuthLink href="/auth/login">Back to sign in</AuthLink>}
        >
          <ol className="flex flex-col gap-2 text-[11px] font-mono text-muted-foreground">
            {[
              "Open the email from Info Hub",
              "Follow the reset link",
              "Choose a new password",
            ].map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="text-foreground tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </AuthPanel>
      </div>
    );
  }

  return (
    <div className={cn(className)} {...props}>
      <AuthPanel
        eyebrow="Password Reset"
        title="Forgot it? Fine."
        description="Give us the address on the account and we'll send a single-use link to set a new password."
        footer={
          <>
            Remembered it? <AuthLink href="/auth/login">Sign in</AuthLink>
          </>
        }
      >
        <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <AuthError>{error}</AuthError>}

          <AuthSubmit pending={isLoading} pendingLabel="Sending">
            Send reset link
          </AuthSubmit>
        </form>
      </AuthPanel>
    </div>
  );
}
