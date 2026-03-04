import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exec } from "child_process";
import path from "path";

// Only allow triggering from authenticated users
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const domain = body.domain as string | undefined; // 'sports' | 'markets' | 'news' | 'media' | undefined (all)

    // Build CLI args
    const args: string[] = [];
    if (domain && ["sports", "markets", "news", "media"].includes(domain)) {
      args.push(`--${domain}-only`);
    }
    args.push("--no-candles"); // Skip slow candle fetching on manual triggers

    const scriptPath = path.join(process.cwd(), "src", "api", "run_etl.py");
    const command = `python3 ${scriptPath} ${args.join(" ")}`;

    return new Promise<NextResponse>((resolve) => {
      exec(
        command,
        {
          timeout: 120_000, // 2 minute timeout
          env: {
            ...process.env,
            PYTHONPATH: path.join(process.cwd(), "src", "api"),
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
    message: "ETL trigger endpoint. Use POST with optional { domain: 'sports'|'markets'|'news'|'media' }",
    domains: ["sports", "markets", "news", "media"],
  });
}
