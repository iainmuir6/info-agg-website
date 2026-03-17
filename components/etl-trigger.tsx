"use client";

import { useState } from "react";

type Domain = "sports" | "markets" | "news" | "media";

interface EtlTriggerButtonProps {
  domain?: Domain;
}

export function EtlTriggerButton({ domain }: EtlTriggerButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      const res = await fetch("/api/etl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(domain ? { domain } : {}),
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const label =
    status === "loading"
      ? "RUNNING…"
      : status === "ok"
        ? "DONE ✓"
        : status === "error"
          ? "FAILED ✗"
          : domain
            ? `RUN ${domain.toUpperCase()}`
            : "RUN ETL";

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading"}
      className="text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 transition-colors disabled:opacity-50
        hover:border-foreground hover:text-foreground text-muted-foreground"
    >
      {label}
    </button>
  );
}
