import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import { getEtlPythonExecutable } from "@/lib/etl-python";

// Vercel Cron — daily ETL at 12:00 UTC (7am EST / 8am EDT).
// Note: Vercel cron does not support timezone-aware schedules; 12:00 UTC
// equals 7am EST (UTC-5) in winter and 8am EDT (UTC-4) in summer.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cwd = process.cwd();
  const scriptPath = path.join(cwd, "src", "api", "run_etl.py");
  const python = getEtlPythonExecutable(cwd);

  return new Promise<NextResponse>((resolve) => {
    execFile(
      python,
      [scriptPath],
      {
        timeout: 55_000, // 55s — 5s buffer before Vercel's 60s function limit
        env: {
          ...process.env,
          PYTHONPATH: path.join(cwd, "src", "api"),
        },
      },
      (err, stdout, stderr) => {
        if (err?.killed) {
          resolve(NextResponse.json({ error: "ETL timed out" }, { status: 408 }));
        } else if (err) {
          console.error("Cron ETL error:", stderr);
          resolve(
            NextResponse.json(
              { success: false, details: stderr?.slice(0, 500) },
              { status: 500 }
            )
          );
        } else {
          resolve(NextResponse.json({ success: true, output: stdout?.slice(-1000) }));
        }
      }
    );
  });
}
