import fs from "fs";
import path from "path";

/**
 * Interpreter for `src/api/run_etl.py`. Uses `_agg_venv` when present so
 * `supabase` and other ETL deps match repo root `requirements.txt`.
 */
export function getEtlPythonExecutable(cwd = process.cwd()): string {
  const candidates = [
    path.join(cwd, "_agg_venv", "bin", "python3"),
    path.join(cwd, "_agg_venv", "bin", "python"),
    path.join(cwd, "_agg_venv", "Scripts", "python.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === "win32" ? "python" : "python3";
}
