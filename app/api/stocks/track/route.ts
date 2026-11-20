import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAllowedSameOriginMutation } from "@/lib/security";
import { addTrackedStock } from "@/lib/tracked-stocks";

const STATUS = { invalid: 422, full: 409, unavailable: 503, error: 500 } as const;

// POST /api/stocks/track { ticker } — favorite a stock for the signed-in
// user, tracking it first when the ETL doesn't quote it yet (validated with
// Finnhub, capped at 10 by the database). All logic is lib/tracked-stocks.ts.
export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginMutation(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ticker = "";
  try {
    const body = (await request.json()) as { ticker?: unknown };
    ticker = typeof body.ticker === "string" ? body.ticker : "";
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  let result;
  try {
    result = await addTrackedStock(ticker, data.claims.sub as string);
  } catch {
    return NextResponse.json({ error: "Add Failed", code: "error" }, { status: 500 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.code] });
  }

  if (result.newlyTracked) {
    revalidateTag("etl-data", "max");
    revalidatePath("/markets");
  }
  return NextResponse.json(result);
}
