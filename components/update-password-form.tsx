"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Chromeless password form — no card, no heading of its own. It renders in two
 * places (the `/profile` "Change Password" section and the standalone
 * `/auth/update-password` page), and both already supply their own framing, so
 * owning a Card here meant a box inside a box on the profile page.
 */
export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"form">) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    setSaved(false);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Confirm in place rather than relying on the redirect alone — on
      // /profile the push is a no-op (already there), so a successful save
      // used to give no feedback at all.
      setSaved(true);
      setPassword("");
      router.push("/profile");
      router.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-2", className)} {...props}>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <label
          htmlFor="password"
          className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground sm:w-32 sm:shrink-0"
        >
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setSaved(false);
          }}
          className="flex-1 min-w-0 text-[11px] font-mono bg-transparent border border-border px-2 py-1.5 outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={isLoading || password.length === 0}
          className="shrink-0 text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors disabled:opacity-40 disabled:hover:border-border"
        >
          {isLoading ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <p className="text-[10px] font-mono" style={{ color: "hsl(0 72% 50%)" }}>
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-[10px] font-mono" style={{ color: "hsl(142 65% 42%)" }}>
          Password updated.
        </p>
      )}
    </form>
  );
}
