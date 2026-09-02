"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AuthError,
  AuthField,
  AuthLink,
  AuthPanel,
  AuthSubmit,
} from "@/components/auth/auth-ui";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

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
        {/* iOS Safari and Chrome key AutoFill off a real form containing named
            credential fields. These inputs previously had neither `name` nor
            `autoComplete`, which is why the keychain suggestion stopped
            appearing — the heuristics had nothing to match on. */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
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
            id="current-password"
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            revealable
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

          <AuthSubmit pending={isLoading} pendingLabel="Signing in">
            Sign in
          </AuthSubmit>
        </form>
      </AuthPanel>
    </div>
  );
}
