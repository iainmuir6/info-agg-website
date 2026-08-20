"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Chromeless display-name form — same framing contract as UpdatePasswordForm:
 * the profile page's SectionCard supplies the chrome, this renders only the
 * inline label/input/button row.
 */
export function UpdateDisplayNameForm({
  initialName,
  className,
  ...props
}: { initialName: string } & React.ComponentPropsWithoutRef<"form">) {
  const [name, setName] = useState(initialName);
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
      const { error } = await supabase.auth.updateUser({
        data: { display_name: name.trim() },
      });
      if (error) throw error;
      // The header initials read user_metadata out of the JWT claims, which
      // only pick up the change on the next token refresh — force one so the
      // bubble updates now instead of whenever the token happens to rotate.
      await supabase.auth.refreshSession();
      setSaved(true);
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
          htmlFor="display-name"
          className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground sm:w-32 sm:shrink-0"
        >
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          autoComplete="name"
          placeholder="First Last"
          maxLength={60}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="flex-1 min-w-0 text-[11px] font-mono bg-transparent border border-border px-2 py-1.5 outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={isLoading || name.trim() === initialName.trim()}
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
          Display name updated.
        </p>
      )}
    </form>
  );
}
