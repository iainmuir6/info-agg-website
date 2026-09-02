"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAuthCallbackUrl } from "@/lib/site-url";
import {
  AuthError,
  AuthField,
  AuthLink,
  AuthPanel,
  AuthSubmit,
} from "@/components/auth/auth-ui";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const mismatch =
    repeatPassword.length > 0 && password !== repeatPassword;

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getAuthCallbackUrl()}?next=${encodeURIComponent("/")}`,
        },
      });
      if (error) throw error;
      router.push("/auth/sign-up-success");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn(className)} {...props}>
      <AuthPanel
        eyebrow="New Account"
        title="Start your edition."
        description="One account, one dashboard — pick the teams, tickers and podcasts you follow and the front page rearranges around them."
        footer={
          <>
            Already registered? <AuthLink href="/auth/login">Sign in</AuthLink>
          </>
        }
      >
        <form onSubmit={handleSignUp} className="flex flex-col gap-4">
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

          <AuthField
            id="new-password"
            name="new-password"
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            revealable
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <AuthField
            id="repeat-password"
            name="repeat-password"
            label="Repeat password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />

          {mismatch && !error && (
            <p
              className="text-[10px] font-mono tracking-wider uppercase"
              style={{ color: "hsl(45 90% 45%)" }}
            >
              Passwords do not match yet
            </p>
          )}
          {error && <AuthError>{error}</AuthError>}

          <AuthSubmit pending={isLoading} pendingLabel="Creating account">
            Create account
          </AuthSubmit>
        </form>
      </AuthPanel>
    </div>
  );
}
