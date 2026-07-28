import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { isAllowedSameOriginMutation } from "@/lib/security";

// Triggers the GitHub Actions ETL workflows via workflow_dispatch and
// returns immediately — Vercel serverless has no Python runtime, so the
// pipeline cannot run in-process. Progress is visible in info_agg.etl_runs
// (written by the Python orchestrators) and the Actions tab.
//
// Requires env:
//   GITHUB_DISPATCH_TOKEN — fine-grained PAT with Actions read/write on the repo
//   GITHUB_REPOSITORY     — owner/repo (defaults below)

const REPO = process.env.GITHUB_REPOSITORY ?? "iainmuir6/info-agg-website";
const BRANCH = process.env.GITHUB_DISPATCH_REF ?? "main";

async function dispatchWorkflow(
  workflowFile: string,
  inputs: Record<string, string> | undefined,
  token: string
): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: BRANCH, ...(inputs ? { inputs } : {}) }),
    }
  );
}

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

    const res =
      mode === "quick"
        ? await dispatchWorkflow("intraday-refresh.yml", { tier: "b" }, token)
        : await dispatchWorkflow("daily-etl.yml", undefined, token);

    if (res.status !== 204) {
      const detail = await res.text().catch(() => "");
      console.error("workflow_dispatch failed:", res.status, detail);
      return NextResponse.json(
        { success: false, error: `GitHub dispatch failed (${res.status})` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      queued: mode === "quick" ? "intraday-refresh (tier b)" : "daily-etl",
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
