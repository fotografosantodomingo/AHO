'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LOCALES } from '@/i18n/config';

/**
 * Saved-search server actions for the buyer-side dashboard.
 *
 * Auth model: every action runs in user-context against Supabase. RLS
 * (`saved_searches_owner_*` policies in migration 0010) enforces that
 * users can only touch their own rows; we don't need a JS-side admin
 * check here. Anonymous callers are blocked by the policies' implicit
 * `auth.uid()` requirement.
 *
 * Per CLAUDE.md hard rule #4: "The frontend never decides what a user
 * can do. It asks the database." These actions are convenience —
 * RLS is the source of truth.
 */

// Filter shape stored in the JSONB column. Matches the public
// SearchFilters type in lib/listings/search.ts (sans `page` — saved
// searches always start at page 1) but is validated independently so
// junk doesn't reach the column.
const SavedFiltersSchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(120).optional(),
    transaction: z.enum(['sale', 'rent', 'short_term']).optional(),
    minPrice: z.number().int().nonnegative().optional(),
    maxPrice: z.number().int().nonnegative().optional(),
    bedsMin: z.number().int().min(0).max(20).optional(),
  })
  .strict();

const SaveInputSchema = z.object({
  name: z.string().trim().max(120).optional(),
  filters: SavedFiltersSchema,
  locale: z.enum(LOCALES),
  notifyEmail: z.boolean().default(true),
});

export type SaveSearchInput = z.input<typeof SaveInputSchema>;
export type SaveSearchResult =
  | { ok: true; id: string }
  | { ok: false; error: 'unauthenticated' | 'invalid' | 'insert_failed' | 'duplicate' };

/**
 * Insert a new saved search owned by the calling user.
 *
 * Idempotency: if the user already has a saved search with an identical
 * filter object (same JSONB), we return the existing row's ID instead of
 * inserting a duplicate. The unique check is informal — duplicates aren't
 * a correctness bug, just clutter on the dashboard list.
 */
export async function saveSearch(input: SaveSearchInput): Promise<SaveSearchResult> {
  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) {
    console.warn('[saveSearch] invalid input', parsed.error.flatten());
    return { ok: false, error: 'invalid' };
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return { ok: false, error: 'unauthenticated' };

  // Best-effort dedup: check for an existing saved search with the same
  // filters JSONB. If we find one, return it.
  const { data: existing } = await supabase
    .from('saved_searches')
    .select('id, filters')
    .eq('user_id', userResult.user.id);
  if (existing) {
    const match = existing.find(
      (r) => JSON.stringify(r.filters) === JSON.stringify(parsed.data.filters),
    );
    if (match) return { ok: true, id: match.id as string };
  }

  const { data, error } = await supabase
    .from('saved_searches')
    .insert({
      user_id: userResult.user.id,
      name: parsed.data.name?.length ? parsed.data.name : null,
      filters: parsed.data.filters,
      locale: parsed.data.locale,
      notify_email: parsed.data.notifyEmail,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[saveSearch] insert failed', error);
    return { ok: false, error: 'insert_failed' };
  }

  revalidatePath('/[locale]/dashboard/saved-searches', 'page');
  return { ok: true, id: data.id as string };
}

export async function deleteSavedSearch(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from('saved_searches').delete().eq('id', id);
  if (error) {
    console.error('[deleteSavedSearch]', error);
    return { ok: false, error: error.message };
  }
  revalidatePath('/[locale]/dashboard/saved-searches', 'page');
  return { ok: true };
}

export async function toggleSavedSearchNotify(
  id: string,
  notify: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('saved_searches')
    .update({ notify_email: notify })
    .eq('id', id);
  if (error) {
    console.error('[toggleSavedSearchNotify]', error);
    return { ok: false, error: error.message };
  }
  revalidatePath('/[locale]/dashboard/saved-searches', 'page');
  return { ok: true };
}
