"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * "1" in the owner's browser: their visits are still recorded, but under
 * OWNER_PATH_PREFIX, so the Activity dashboard can include or exclude them.
 * Set by OwnerMark on pages only the super_admin reaches.
 */
export const OWNER_FLAG = "va-owner";
export const OWNER_PATH_PREFIX = "/__me";

function beforeSend(event: BeforeSendEvent) {
  const url = new URL(event.url);
  try {
    if (localStorage.getItem(OWNER_FLAG) === "1") {
      url.pathname = OWNER_PATH_PREFIX + (url.pathname === "/" ? "" : url.pathname);
      return { ...event, url: url.toString() };
    }
  } catch {
    // Storage blocked: record as a normal visit.
  }
  return event;
}

export function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
