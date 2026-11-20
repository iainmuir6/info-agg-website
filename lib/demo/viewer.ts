import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";

/**
 * True when the signed-in viewer's login is in demo mode (`app_metadata.demo`, set by scripts/demo-accounts.ts for the
 * public demo video). Honoured only below super admin, so an admin login can never be shown fake data, or a demo login
 * turned into an admin view. Signed-out visitors and normal logins are never in demo mode.
 */
export async function isDemoViewer(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data } = await supabase.auth.getClaims();
  const appMeta = data?.claims?.app_metadata as { demo?: unknown } | undefined;
  if (appMeta?.demo !== true) return false;
  return !(await isSuperAdmin());
}
