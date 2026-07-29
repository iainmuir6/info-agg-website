import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchPodcasts } from "@/lib/spotify-search";

// GET /api/podcasts/search?q=... — backs the "look up a podcast to favorite"
// UI. Signed-in only: this proxies to Spotify using our own app credentials,
// so an anonymous open endpoint would let anyone burn that quota.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchPodcasts(q);
  return NextResponse.json({ results });
}
