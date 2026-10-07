import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (build output)
     * - site metadata that must stay reachable while signed out: the favicon,
     *   the web app manifest, the push service worker, robots and sitemap.
     *   A session redirect answers these with a 307 and nothing errors --
     *   the browser just falls back to defaults, which is how "Add to Home Screen" loses its icon and its
     *   standalone mode, and how a crawler reads a login page.
     * - static assets by extension
     */
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
