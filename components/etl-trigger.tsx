"use client";

import { useState } from "react";

export function EtlTriggerButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      const res = await fetch("/api/etl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "quick" }),
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const label =
    status === "loading" ? "RUNNING…"
    : status === "ok"    ? "DONE ✓"
    : status === "error" ? "FAILED ✗"
    : "QUICK REFRESH";

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading"}
      className="text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5
        transition-colors disabled:opacity-50 hover:border-foreground hover:text-foreground text-muted-foreground"
    >
      {label}
    </button>
  );
}
