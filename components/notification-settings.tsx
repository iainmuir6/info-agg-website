"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  currentSubscription,
  disableOnThisDevice,
  enableOnThisDevice,
  pushSupport,
  refreshSubscription,
  type PushSupport,
} from "@/lib/push";
import { cn } from "@/lib/utils";

/**
 * Morning briefing notifications, on /profile. Chromeless — the page's
 * SectionCard supplies the frame, as with the display-name form.
 *
 * Two separate facts, two separate controls:
 *   THIS DEVICE  whether this browser / home-screen app receives anything
 *                (a push subscription — one per device)
 *   TOPICS       which briefings you want, saved to your account, so the
 *                choice follows you to every device
 *
 * Timing is the server's (supabase/13_notifications.sql): a briefing written
 * overnight arrives at 7am ET, and a Monday's two arrive as one.
 */

const TOPICS = [
  { topic: "summary.day", label: "Summary of the Day", detail: "Each morning" },
  { topic: "summary.week", label: "Summary of the Week", detail: "Monday mornings" },
] as const;

type Settings = {
  topics: Record<string, boolean>;
  device: boolean;
  devices: number;
};

export function NotificationSettings() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      const s = pushSupport();
      const sub = await currentSubscription().catch(() => null);
      if (sub) await refreshSubscription(sub);
      const { data } = await createClient().rpc("notify_settings", {
        p_endpoint: sub?.endpoint ?? null,
      });
      if (!live) return;
      setSupport(s);
      setSettings((data as Settings | null) ?? { topics: {}, device: false, devices: 0 });
    })();
    return () => {
      live = false;
    };
  }, []);

  const deviceOn = !!settings?.device;
  const others = (settings?.devices ?? 0) - (deviceOn ? 1 : 0);

  function toggleDevice() {
    setMessage(null);
    startTransition(async () => {
      try {
        if (deviceOn) {
          await disableOnThisDevice();
          setSettings((s) => s && { ...s, device: false, devices: Math.max(0, s.devices - 1) });
          setMessage({ text: "Off on this device." });
          return;
        }
        await enableOnThisDevice();
        // First device on: switch every briefing on rather than leaving the
        // person subscribed to nothing. Choices already made are kept.
        const unset = TOPICS.filter((t) => settings?.topics[t.topic] === undefined);
        const supabase = createClient();
        await Promise.all(
          unset.map((t) =>
            supabase.rpc("notify_set_topic", { p_topic: t.topic, p_enabled: true }),
          ),
        );
        setSettings((s) => ({
          topics: {
            ...Object.fromEntries(unset.map((t) => [t.topic, true])),
            ...(s?.topics ?? {}),
          },
          device: true,
          devices: (s?.devices ?? 0) + (s?.device ? 0 : 1),
        }));
        setMessage({ text: "On for this device." });
      } catch (err) {
        setMessage({
          text: err instanceof Error ? err.message : "Couldn't change notifications.",
          error: true,
        });
        setSupport(pushSupport());
      }
    });
  }

  function toggleTopic(topic: string, enabled: boolean) {
    const before = settings;
    setMessage(null);
    setSettings((s) => s && { ...s, topics: { ...s.topics, [topic]: enabled } });
    startTransition(async () => {
      const { error } = await createClient().rpc("notify_set_topic", {
        p_topic: topic,
        p_enabled: enabled,
      });
      if (error) {
        setSettings(before);
        setMessage({ text: "Couldn't save that preference.", error: true });
      }
    });
  }

  if (!settings || !support) {
    return <p className="px-3 py-2.5 text-[11px] font-mono text-muted-foreground">Loading…</p>;
  }

  const status =
    support === "needs-install"
      ? "On iPhone/iPad, add Info Hub to your Home Screen (Share → Add to Home Screen) and open it from there."
      : support === "unsupported"
        ? "This browser can't receive push notifications."
        : support === "denied" && !deviceOn
          ? "Blocked for this site — allow notifications in your browser settings."
          : deviceOn
            ? "Receiving briefings here."
            : "Off on this device.";

  return (
    <div className="divide-y divide-border">
      <div className="px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono tracking-widest uppercase font-bold">This Device</p>
          <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
            {status}
            {others > 0 && ` Also on ${others} other device${others === 1 ? "" : "s"}.`}
          </p>
        </div>
        {(support === "ok" || deviceOn) && (
          <button
            type="button"
            onClick={toggleDevice}
            disabled={pending}
            className="shrink-0 text-[10px] font-mono tracking-widest uppercase border border-border px-3 py-1.5 hover:border-foreground transition-colors disabled:opacity-50"
          >
            {pending ? "…" : deviceOn ? "Turn Off" : "Turn On"}
          </button>
        )}
      </div>

      {TOPICS.map((t) => {
        const on = settings.topics[t.topic] ?? false;
        return (
          <div key={t.topic} className="px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-mono">{t.label}</p>
              <p className="text-[10px] font-mono text-muted-foreground">
                {t.detail} · from 7am ET
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={t.label}
              disabled={pending}
              onClick={() => toggleTopic(t.topic, !on)}
              className={cn(
                "shrink-0 text-[9px] font-mono tracking-widest uppercase font-bold border px-2 py-1 transition-colors disabled:opacity-50",
                on
                  ? "border-[hsl(142_65%_42%)] text-[hsl(142_65%_42%)]"
                  : "border-border text-muted-foreground hover:border-foreground",
              )}
            >
              {on ? "On" : "Off"}
            </button>
          </div>
        );
      })}

      {message && (
        <p
          className={cn(
            "px-3 py-2 text-[11px] font-mono",
            message.error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
