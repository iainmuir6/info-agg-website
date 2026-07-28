import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

// Called by the ETL workflows after a successful run so cached data
// (tag: 'etl-data') refreshes within seconds of new rows landing.
// Auth: Authorization: Bearer <REVALIDATE_SECRET>.
export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Next 16 signature: the profile controls how stale entries are served
  // while refreshing; "max" = expire immediately, refetch on next request.
  revalidateTag("etl-data", "max");
  return NextResponse.json({ revalidated: true, tag: "etl-data" });
}
