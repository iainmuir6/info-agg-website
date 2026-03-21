/**
 * Canonical public site origin (no trailing slash).
 * Set NEXT_PUBLIC_SITE_URL in production (e.g. https://your-app.vercel.app).
 */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export function getAuthCallbackUrl(): string {
  return `${getSiteUrl()}/auth/callback`;
}

/** Same-origin path only; avoids open redirects after auth callback. */
export function isSafeAuthNextPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes("://")) return false;
  if (path.startsWith("/auth/callback")) return false;

  if (path === "/") return true;

  const prefixes = [
    "/auth/",
    "/profile",
    "/watchlist",
    "/premium",
    "/dashboard",
  ];

  return prefixes.some((p) =>
    p.endsWith("/")
      ? path.startsWith(p)
      : path === p || path.startsWith(`${p}/`),
  );
}
