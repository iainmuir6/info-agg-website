"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EtlTriggerButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const router = useRouter();

  async function handleClick() {
    setStatus("loading");
    try {
      const res = await fetch("/api/etl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "quick" }),
      });
      setStatus(res.ok ? "ok" : "error");
      if (res.ok) {
        // The workflow runs on GitHub Actions; fresh data lands in a few
        // minutes. Refresh now so any already-revalidated data appears.
        router.refresh();
      }
    } catch {
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 5000);
    }
  }

  const label =
    status === "loading" ? "QUEUING…"
    : status === "ok"    ? "QUEUED ✓"
    : status === "error" ? "FAILED ✗"
    : "QUICK REFRESH";

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading"}
      title="Queues an intraday refresh on GitHub Actions (data lands in ~2 min)"
      className="text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5
        transition-colors disabled:opacity-50 hover:border-foreground hover:text-foreground text-muted-foreground"
    >
      {label}
    </button>
  );
}
