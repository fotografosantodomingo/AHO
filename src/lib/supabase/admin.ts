import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/**
 * Service-role Supabase client. **Bypasses RLS by design.**
 *
 * Hard rule (CLAUDE.md #4): the frontend never decides what a user can do.
 * This module is the *only* place that uses the service-role key. Importing
 * it from any client component, API route serving user requests, or Server
 * Action serving user requests is a violation. Use it only for:
 *
 *   - Stripe webhook handlers (system actor; no user context exists)
 *   - Cloudflare Queue consumers (social fan-out; system actor)
 *   - Migrations and admin scripts
 *   - Cron jobs that must read across all orgs
 *
 * `import 'server-only'` causes Next.js to fail the build if this module
 * leaks into a client bundle.
 *
 * Future: add a custom ESLint rule that flags any import of `@/lib/supabase/admin`
 * outside `app/api/webhooks/**`, `workers/**`, and `scripts/**`.
 */
export function createAdminClient(): SupabaseClient {
  const pub = publicEnv();
  const srv = serverEnv();
  if (!srv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set; admin client cannot be created.',
    );
  }
  return createClient(pub.NEXT_PUBLIC_SUPABASE_URL, srv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
