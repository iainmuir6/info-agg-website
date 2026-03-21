import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isSafeAuthNextPath } from "@/lib/site-url";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next") ?? "/";
  const next = isSafeAuthNextPath(nextRaw) ? nextRaw : "/";

  const errorRedirect = (message: string) => {
    const err = new URL("/auth/error", url.origin);
    err.searchParams.set("error", message.slice(0, 200));
    return NextResponse.redirect(err);
  };

  if (!code) {
    return errorRedirect("missing_code");
  }

  let response = NextResponse.redirect(new URL(next, url.origin));

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
          response = NextResponse.redirect(new URL(next, url.origin));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return errorRedirect(error.message || "exchange_failed");
  }

  return response;
}
