"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.push("/");
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-50"
    >
      {loading ? "SIGNING OUT…" : "SIGN OUT"}
    </button>
  );
}
