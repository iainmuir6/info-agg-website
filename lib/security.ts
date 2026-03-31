import "server-only";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Best-effort CSRF mitigation for cookie-authenticated Route Handlers.
 *
 * - If `Origin` is present (browser requests), require it to match our site origin.
 * - If `Origin` is absent (server-to-server, cron, curl), allow the request.
 */
export function isAllowedSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const siteOrigin = new URL(getSiteUrl()).origin;
    return origin === siteOrigin;
  } catch {
    return false;
  }
}

