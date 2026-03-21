import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client with the service role key.
 * Use only in Route Handlers / Server Actions; never import from client components.
 */
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
