import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

/**
 * Supabase's auth cookies, and only those.
 *
 * `sb-<project-ref>-auth-token`, plus `.0` / `.1` … when the value is large
 * enough to be chunked. The `$` anchor deliberately excludes
 * `sb-<ref>-auth-token-code-verifier`: that is a short-lived PKCE value that
 * has no business being handed a 400-day lifetime.
 */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * Mirrors @supabase/ssr's own DEFAULT_COOKIE_OPTIONS (utils/constants.ts),
 * which the package does not export. These MUST stay in step with it: the
 * browser keys a cookie on (name, domain, path), so a different `path` here
 * would create a second cookie alongside the real one rather than replacing
 * it, and the two would fight.
 *
 * `secure` is ours, not theirs — the library omits it. It is added only when
 * the request actually arrived over HTTPS, because a Secure cookie set over
 * plain http is dropped by the browser and would break local dev. Worst case
 * the check fails and we match the library default exactly.
 */
const SESSION_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  maxAge: 400 * 24 * 60 * 60,
} as const;

function isHttps(request: NextRequest) {
  return (
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip middleware check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // Whether Supabase rotated the tokens on this request and wrote the cookies
  // itself. When it did, those are the authoritative values and already carry
  // a full-length Max-Age, so the sliding re-issue below must not touch them.
  let rotated = false;

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          rotated = true;
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  let user: unknown = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    user = error ? null : data?.claims;

    // Only protect explicitly private routes (e.g. /premium, /dashboard).
    // All public routes (/, /news, /sports, /markets, /media) are open.
    const PRIVATE_PREFIXES = ["/premium", "/dashboard", "/profile", "/watchlist"];
    const isPrivate = PRIVATE_PREFIXES.some((p) =>
      request.nextUrl.pathname.startsWith(p)
    );

    if (isPrivate && !user) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      const redirect = NextResponse.redirect(url);
      // Carry over anything Supabase wrote — on this path that is the cookie
      // *clearing* it emits when a session turns out to be dead. Dropping it
      // left the browser holding a token the server had already rejected, so
      // every later request re-ran the same failed refresh.
      supabaseResponse.cookies
        .getAll()
        .forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }
  } catch {
    // Auth errors are non-fatal for public routes — continue normally.
  }

  // ---------------------------------------------------------------------
  // Sliding re-issue, for WebKit's sake.
  //
  // The browser client writes the auth cookie with document.cookie and asks
  // for 400 days; WebKit caps anything written from script at 7. Cookies sent
  // as a real Set-Cookie header are not capped that way, but Supabase only
  // emits one when it actually rotates the tokens (setAll, above) — roughly
  // hourly. An installed PWA opened briefly and often can therefore go a long
  // time on nothing but the 7-day script cookie and then simply lose it.
  //
  // So on any authenticated request that did NOT rotate, re-send the cookies
  // the browser just sent us, unchanged, as a server Set-Cookie. Same values,
  // same flags, no new authority — this only restores the lifetime the client
  // was always meant to have. Session validity is still decided server-side:
  // a revoked or expired refresh token fails at Supabase no matter how long
  // the cookie lives.
  // ---------------------------------------------------------------------
  if (user && !rotated) {
    const options = isHttps(request)
      ? { ...SESSION_COOKIE_OPTIONS, secure: true }
      : SESSION_COOKIE_OPTIONS;

    for (const cookie of request.cookies.getAll()) {
      if (AUTH_COOKIE.test(cookie.name)) {
        supabaseResponse.cookies.set(cookie.name, cookie.value, options);
      }
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
