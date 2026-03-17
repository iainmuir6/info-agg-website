import { createPublicClient } from "./supabase/public-client";

/**
 * Returns true if the currently authenticated user has the
 * `super_admin` role for this project via `public.is_super_admin()`.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const supabase = await createPublicClient();
  const { data } = await supabase.rpc("is_super_admin");
  return data === true;
}
