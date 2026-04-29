'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Browser Supabase client. Operates as the signed-in user with RLS active.
 * Use this only inside Client Components.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const pub = publicEnv();
  cached = createBrowserClient(
    pub.NEXT_PUBLIC_SUPABASE_URL,
    pub.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return cached;
}
