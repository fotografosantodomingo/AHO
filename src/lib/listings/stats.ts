import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface HomepageStats {
  activeListings: number;
  cities: number;
  verifiedAgents: number;
}

/**
 * Aggregate stats for the homepage trust strip. All three values come from
 * real data — when the platform is empty (pre-soft-beta), every count is 0
 * and the homepage hides the strip entirely (real-only data rule, CLAUDE.md
 * hard rule #8).
 *
 * Fixture exclusion follows the belt-and-suspenders pattern from sitemap +
 * city-landing + agent-profile helpers: filter `aho-test-org-%` org slugs
 * via inner-join, then defensively re-filter in the city/listing pass.
 */
export async function getHomepageStats(): Promise<HomepageStats> {
  const supabase = await createServerSupabaseClient();

  const { data: listings } = await supabase
    .from('properties')
    .select('city, organizations!inner(slug)')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%');

  const rows = listings ?? [];
  const cities = new Set<string>();
  for (const row of rows) {
    if (row.city) cities.add(row.city.trim().toLowerCase());
  }

  const { count: orgCount } = await supabase
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .not('slug', 'like', 'aho-test-org-%');

  return {
    activeListings: rows.length,
    cities: cities.size,
    verifiedAgents: orgCount ?? 0,
  };
}
