import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { isAllowedSameOriginMutation } from "@/lib/security";
import { describeEtlJob, dispatchEtl } from "@/lib/github-dispatch";

// Triggers the GitHub Actions ETL workflows via workflow_dispatch and
// returns immediately — Vercel serverless has no Python runtime, so the
// pipeline cannot run in-process. Progress is visible in info_agg.etl_runs
// (written by the Python orchestrators) and the Actions tab.
//
// This is the admin button on /dashboard. The unattended schedule lives in
// vercel.json → GET /api/cron/etl; both share lib/github-dispatch.
//
// Requires env:
//   GITHUB_DISPATCH_TOKEN — fine-grained PAT with Actions read/write on the repo
//   GITHUB_REPOSITORY     — owner/repo (defaults in lib/github-dispatch)

// Only allow triggering from super_admin users
export async function POST(request: NextRequest) {
  try {
    if (!isAllowedSameOriginMutation(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await isSuperAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GITHUB_DISPATCH_TOKEN not configured" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode as string | undefined; // 'quick' → intraday tier B; else full daily run
    const job = mode === "quick" ? "b" : "daily";

    const result = await dispatchEtl(job, token);
    if (!result.ok) {
      console.error("workflow_dispatch failed:", result.status, result.detail);
      return NextResponse.json(
        { success: false, error: `GitHub dispatch failed (${result.status})` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      queued: describeEtlJob(job),
      note: "Run queued on GitHub Actions; status appears in etl_runs when it starts.",
    });
  } catch (err) {
    console.error("ETL route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message:
      "ETL trigger endpoint. POST {} to queue the full daily workflow, or { mode: 'quick' } for an intraday tier-B refresh.",
    modes: ["quick"],
  });
}
