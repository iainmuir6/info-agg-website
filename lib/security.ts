import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Best-effort CSRF mitigation for cookie-authenticated Route Handlers.
 *
 * - If `Origin` is present (browser requests), require it to match the server's
 *   own host (derived from the `Host` / `X-Forwarded-Host` request header).
 *   This is always correct regardless of how NEXT_PUBLIC_SITE_URL is set, so
 *   local dev with a production NEXT_PUBLIC_SITE_URL still works.
 * - If `Origin` is absent (server-to-server, cron, curl), allow the request.
 */
export function isAllowedSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    // Prefer the actual host the server is listening on over the configured
    // site URL, so local dev (localhost) is never blocked by a prod URL.
    const forwardedHost = (request.headers as Headers).get?.("x-forwarded-host");
    const host = forwardedHost ?? (request.headers as Headers).get?.("host");
    if (host) {
      const proto = (request.headers as Headers).get?.("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
      const serverOrigin = `${proto}://${host}`;
      return origin === serverOrigin;
    }

    // Fallback: compare against the configured site URL.
    const siteOrigin = new URL(getSiteUrl()).origin;
    return origin === siteOrigin;
  } catch {
    return false;
  }
}


/**
 * Constant-time check of `Authorization: Bearer <secret>` for routes called by
 * machines (Vercel Cron, the ETL workflow). False when the secret is unset.
 */
export function hasBearerSecret(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
