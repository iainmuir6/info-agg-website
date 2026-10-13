import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { hasBearerSecret } from "@/lib/security";

// Called by the ETL workflows after a successful run so cached data
// (tag: 'etl-data') refreshes within seconds of new rows landing.
// Auth: Authorization: Bearer <REVALIDATE_SECRET>.
export async function POST(request: NextRequest) {
  if (!hasBearerSecret(request, process.env.REVALIDATE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Next 16 signature: the profile controls how stale entries are served
  // while refreshing; "max" = expire immediately, refetch on next request.
  revalidateTag("etl-data", "max");
  return NextResponse.json({ revalidated: true, tag: "etl-data" });
}
