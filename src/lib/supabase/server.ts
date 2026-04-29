import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server-side Supabase client that respects the user's session cookie.
 * Use this in Server Components, Route Handlers, and Server Actions for
 * any operation that should run as the authenticated user with RLS active.
 *
 * Do NOT use this for cross-org admin reads or system actions — those use
 * `@/lib/supabase/admin`.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const pub = publicEnv();
  return createServerClient(
    pub.NEXT_PUBLIC_SUPABASE_URL,
    pub.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component context — cookies cannot be set here.
            // Middleware refreshes them on next response.
          }
        },
      },
    },
  );
}
