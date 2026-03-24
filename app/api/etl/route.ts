import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { execFile } from "child_process";
import path from "path";
import { getEtlPythonExecutable } from "@/lib/etl-python";

// Only allow triggering from super_admin users
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await isSuperAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const domain = body.domain as string | undefined; // 'sports' | 'markets' | 'news' | 'media' | undefined (all)
    const mode = body.mode as string | undefined;     // 'quick' → run_quick_refresh.py

    const cwd = process.cwd();
    const python = getEtlPythonExecutable(cwd);

    // Quick refresh: sports + news + quotes only, no sentiment/econ/media
    if (mode === "quick") {
      const scriptPath = path.join(cwd, "src", "api", "run_quick_refresh.py");
      return new Promise<NextResponse>((resolve) => {
        execFile(
          python,
          [scriptPath],
          {
            timeout: 120_000,
            env: {
              ...process.env,
              PYTHONPATH: path.join(cwd, "src", "api"),
            },
          },
          (err, stdout, stderr) => {
            if (err && err.code !== 0) {
              console.error("Quick refresh ETL error:", stderr);
              resolve(
                NextResponse.json(
                  { success: false, error: "Quick refresh ETL failed", details: stderr?.slice(0, 500) },
                  { status: 500 }
                )
              );
            } else {
              resolve(NextResponse.json({ success: true, mode: "quick", output: stdout?.slice(-1000) }));
            }
          }
        );
      });
    }

    // Build CLI args for full ETL
    const args: string[] = [];
    if (domain && ["sports", "markets", "news", "media"].includes(domain)) {
      args.push(`--${domain}-only`);
    }
    // OHLCV/candle backfill is not part of run_etl.py (use run_db_seed.py); no --no-candles flag.

    const scriptPath = path.join(cwd, "src", "api", "run_etl.py");

    return new Promise<NextResponse>((resolve) => {
      execFile(
        python,
        [scriptPath, ...args],
        {
          timeout: 120_000, // 2 minute timeout
          env: {
            ...process.env,
            PYTHONPATH: path.join(cwd, "src", "api"),
          },
        },
        (err, stdout, stderr) => {
          if (err && err.code !== 0) {
            console.error("ETL error:", stderr);
            resolve(
              NextResponse.json(
                {
                  success: false,
                  error: "ETL run failed",
                  details: stderr?.slice(0, 500),
                },
                { status: 500 }
              )
            );
          } else {
            resolve(
              NextResponse.json({
                success: true,
                domain: domain ?? "all",
                output: stdout?.slice(-1000), // last 1000 chars
              })
            );
          }
        }
      );
    });
  } catch (err) {
    console.error("ETL route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: "ETL trigger endpoint. POST with { domain } for a single domain, { mode: 'quick' } for fast refresh, or no body for full run.",
    domains: ["sports", "markets", "news", "media"],
    modes: ["quick"],
  });
}
