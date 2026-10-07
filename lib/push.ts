"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Web Push, the browser half. The server half is the shared `notify` layer,
 * which lives in the cmf-tracker repo (docs/notifications.md there; see
 * supabase/13_notifications.sql here): this file registers the service worker, asks the
 * browser for a push subscription, and hands it to `info_agg.notify_subscribe`.
 *
 * A subscription belongs to a DEVICE (one browser, or one home-screen app);
 * topic preferences belong to the PERSON and follow them across devices.
 */

/** Public half of the shared VAPID pair. It must equal the constant in
 *  cmf-tracker's supabase/functions/notify-dispatch/index.ts and lib/push.ts —
 *  or every push is rejected by the push service. */
export const VAPID_PUBLIC_KEY =
  "BIau4z92M1vo0oGuiN4An_eDMvgq_CaKQRQQf-sqnzD3whlnE6WIPbbiGXYSw8Dr0uC869aRrWptRUHCf-m6cpU";

const SW_URL = "/sw.js";

/**
 * What this browser can do:
 *  - `ok`              push works here
 *  - `needs-install`   iOS/iPadOS Safari: push exists only for a web app
 *                      added to the Home Screen (16.4+), never in a tab
 *  - `unsupported`     no service worker / Push API at all
 *  - `denied`          the person blocked notifications for this site; only
 *                      the browser's own settings can undo that
 */
export type PushSupport = "ok" | "needs-install" | "unsupported" | "denied";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "needs-install";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  return (
    (await navigator.serviceWorker.getRegistration(SW_URL)) ??
    (await navigator.serviceWorker.register(SW_URL, { scope: "/" }))
  );
}

/** This device's existing subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await createClient()
    .rpc("notify_subscribe", {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh ?? "",
      p_auth: json.keys?.auth ?? "",
      p_user_agent: navigator.userAgent,
    });
  if (error) throw new Error(error.message);
}

/** Ask permission (must run inside a click), subscribe, and record it. */
export async function enableOnThisDevice(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site in your browser settings."
        : "Notifications weren't allowed.",
    );
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
    }));
  await save(sub);
  return sub;
}

export async function disableOnThisDevice(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await createClient()
    .rpc("notify_unsubscribe", { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/**
 * Re-send a subscription the browser still holds. Push services rotate
 * endpoints, and a device that changed hands (sign out, sign in as someone
 * else) should follow the person now using it — so each visit to the
 * settings re-records it, which is an upsert on the endpoint.
 */
export async function refreshSubscription(sub: PushSubscription) {
  try {
    await save(sub);
  } catch {
    // Best-effort; the toggle still reflects what the server said.
  }
}
