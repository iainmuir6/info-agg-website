import "server-only";

// Fires a `workflow_dispatch` against a workflow in this repo. Dispatched runs
// start immediately, unlike GitHub's `schedule:` trigger — which is best-effort
// and, for this repo, degraded to a handful of hours-late runs per day. Both
// the admin button (POST /api/etl) and the Vercel cron entries (GET
// /api/cron/etl) go through here so there is one implementation.
//
// Requires GITHUB_DISPATCH_TOKEN — a fine-grained PAT with Actions read/write.

const REPO = process.env.GITHUB_REPOSITORY ?? "iainmuir6/info-agg-website";
const BRANCH = process.env.GITHUB_DISPATCH_REF ?? "main";

export type EtlJob = "daily" | "a" | "b";

export function isEtlJob(value: string | null): value is EtlJob {
  return value === "daily" || value === "a" || value === "b";
}

/** Human-readable name for the workflow a job maps to, for API responses. */
export function describeEtlJob(job: EtlJob): string {
  return job === "daily" ? "daily-etl" : `intraday-refresh (tier ${job})`;
}

export type DispatchResult =
  | { ok: true }
  | { ok: false; status: number; detail: string };

export async function dispatchEtl(
  job: EtlJob,
  token: string,
  // Recorded as etl_runs.triggered_by, so /dashboard can still tell an
  // unattended Vercel-cron run from someone pressing the admin button.
  triggeredBy: "cron" | "manual" = "manual"
): Promise<DispatchResult> {
  const workflow = job === "daily" ? "daily-etl.yml" : "intraday-refresh.yml";
  const inputs =
    job === "daily"
      ? { triggered_by: triggeredBy }
      : { tier: job, triggered_by: triggeredBy };

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: BRANCH, inputs }),
      cache: "no-store",
    }
  );

  // GitHub returns 204 No Content on a successful dispatch.
  if (res.status === 204) return { ok: true };

  return {
    ok: false,
    status: res.status,
    detail: await res.text().catch(() => ""),
  };
}
