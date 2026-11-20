import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedSameOriginMutation } from "@/lib/security";
import { searchStocksForUser } from "@/lib/tracked-stocks";

// GET /api/stocks/search?q=… backs the Favorites stock search on /profile:
// quoted local rows plus Finnhub's US listings, each marked quoted, addable
// or already a favorite. Signed-in only (it spends our Finnhub quota) and
// same-origin only (no cross-site page can drive it with a user's cookies).
export async function GET(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !isAllowedSameOriginMutation(request) ||
    (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const body = await searchStocksForUser(q, data.claims.sub as string);
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "Search Failed" }, { status: 500 });
  }
}
