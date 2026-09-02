import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isSafeAuthNextPath } from "@/lib/site-url";
import { isAllowedSameOriginMutation } from "@/lib/security";

/**
 * Password sign-in as a real browser form POST.
 *
 * This deliberately is NOT a server action. Both of the problems it solves
 * need an actual navigation, and React intercepts a server-action submit with
 * fetch when JS is loaded, which produces no navigation at all:
 *
 * 1. iOS only offers "Save Password" when it sees a form carrying username +
 *    password submitted, followed by a navigation. The old client-side flow
 *    called preventDefault(), did an XHR and then router.push(), so iOS never
 *    saw a login happen and never saved a credential — which is why AutoFill
 *    had nothing to offer in the installed PWA.
 * 2. Signing in through the browser client wrote the auth cookie with
 *    document.cookie, and WebKit caps script-written cookies at 7 days. Set
 *    here, it arrives as a real Set-Cookie on the redirect and is not capped.
 *    (lib/supabase/proxy.ts slides the cookie on later requests; this closes
 *    the gap at the point the session is created.)
 *
 * 303 rather than 302 so the browser follows with GET instead of re-POSTing.
 */
export async function POST(request: NextRequest) {
  const url = request.nextUrl;

  const backToLogin = (message: string) => {
    const dest = new URL("/auth/login", url.origin);
    // The message is the only thing put on the URL. The submitted email is
    // deliberately NOT echoed back — it would land in browser history and
    // server access logs for no benefit a password manager cannot supply.
    dest.searchParams.set("error", message.slice(0, 200));
    return NextResponse.redirect(dest, 303);
  };

  // Same-origin check before anything else: this route is cookie-authenticated
  // and a plain form POST is cross-site submittable, so without it an attacker
  // could sign a visitor into an account of their choosing.
  if (!isAllowedSameOriginMutation(request)) {
    return backToLogin("Sign-in blocked: request did not come from this site.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backToLogin("Malformed sign-in request.");
  }

  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const nextRaw = String(form.get("next") ?? "/");
  const next = isSafeAuthNextPath(nextRaw) ? nextRaw : "/";

  if (!email || !password) {
    return backToLogin("Enter your email and password.");
  }

  // Collected rather than written straight onto a response: setAll can fire
  // more than once, and rebuilding the response inside it would drop whatever
  // an earlier call had already set.
  const pending: { name: string; value: string; options: object }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: "info_agg" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          pending.push(...cookiesToSet);
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return backToLogin(error.message || "Sign-in failed.");
  }

  const response = NextResponse.redirect(new URL(next, url.origin), 303);
  pending.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  return response;
}
