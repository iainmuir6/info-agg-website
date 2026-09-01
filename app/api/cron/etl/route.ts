import { NextRequest, NextResponse } from "next/server";
import {
  describeEtlJob,
  dispatchEtl,
  isEtlJob,
} from "@/lib/github-dispatch";

// Vercel Cron entry point (see vercel.json). Each cron entry hits this route
// with ?job=daily|a|b and it fires the matching workflow_dispatch, which
// GitHub runs immediately.
//
// Why not GitHub's own `schedule:` trigger: it is best-effort, and this repo's
// scheduled delivery collapsed in Aug 2026 — the 10:43 UTC daily was landing
// between 14:58 and 21:14 UTC, so the site was 8-12h stale every morning.
//
// This path is publicly routable, so it fails closed on CRON_SECRET. Vercel
// attaches `Authorization: Bearer $CRON_SECRET` to cron invocations whenever
// that env var is set on the project.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET not configured — refusing cron dispatch");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = request.nextUrl.searchParams.get("job");
  if (!isEtlJob(job)) {
    return NextResponse.json(
      { error: "Expected ?job=daily|a|b" },
      { status: 400 }
    );
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_TOKEN not configured" },
      { status: 503 }
    );
  }

  const result = await dispatchEtl(job, token, "cron");
  if (!result.ok) {
    console.error("cron workflow_dispatch failed:", result.status, result.detail);
    return NextResponse.json(
      { success: false, error: `GitHub dispatch failed (${result.status})` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, queued: describeEtlJob(job) });
}
